import { tick } from 'svelte';
import { applySessionEvents, isTurnBusy, runSingleFlight } from '$lib';
import {
	reviewContextLimits,
	validateReviewContexts,
	type ImageAttachment,
	type InputAttachment,
	type ReviewContext,
	type ReviewContextSeed
} from '$lib/message-content';
import { formatWorkModeAnnouncement, type WorkMode } from '$lib/work-mode';
import { shouldSendMessage } from '$lib/preferences';
import type { WorkspaceNavigation } from './navigation.svelte';
import type { SessionState } from './session-state.svelte';
import type { TranscriptFollow } from './transcript-follow.svelte';
import type {
	Api,
	HermesCommand,
	HermesRuntime,
	PendingEnvelope,
	Project,
	QueuedMessage,
	Session,
	SessionEvent,
	TranscriptMessage
} from './types';
import { copyCode } from './copy-code';
import { readAttachmentFiles, unavailableAttachmentMetadata } from './attachment-files';
import { MessagePersistence } from './message-persistence';
export type PromptImprovementAnswer = { id: string; question: string; answer: string };
export type PromptImprovementResult = {
	status: 'completed' | 'pending' | 'failed' | 'unknown';
	sessionId: string;
	messageId: string;
	path?: string;
	prompt?: string;
	questions?: Array<{ id: string; question: string }>;
	error?: string;
};
type MessageStateOptions = {
	api: Api;
	getProject: () => Project | null;
	getSession: () => Session | null;
	getNavigation: () => WorkspaceNavigation;
	session: SessionState;
	transcriptFollow: TranscriptFollow;
	prepareVoice: () => void;
	applyVoiceEvents: (events: SessionEvent[], messageId: string) => void;
	focusComposer: () => void;
	setError: (message: string) => void;
	setLoading: (loading: boolean) => void;
};
export class ApiError extends Error {}
export class MessageState {
	composer = $state('');
	composerElement = $state<HTMLTextAreaElement>();
	images = $state<ImageAttachment[]>([]);
	attachments = $state<InputAttachment[]>([]);
	reviewContexts = $state<ReviewContext[]>([]);
	draggingImages = $state(false);
	pendingEnvelope = $state<PendingEnvelope | null>(null);
	editingQueuedMessageId = $state('');
	commandIndex = $state(0);
	messageNotice = $state('');
	stopping = $state(false);
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private pollFlight: { current: Promise<void> | null } = { current: null };
	private persistence: MessagePersistence;
	private promptImprovementOperation: { identity: string; id: string } | null = null;
	constructor(private options: MessageStateOptions) {
		this.persistence = new MessagePersistence(options.getProject, options.getSession);
	}
	private sessionPath(sessionId: string, suffix = '') {
		return this.options.getNavigation().sessionApiPath(sessionId, suffix);
	}
	clear = () => {
		this.pendingEnvelope = null;
		this.editingQueuedMessageId = '';
		this.messageNotice = '';
		this.images = [];
		this.attachments = [];
		this.reviewContexts = [];
	};
	submit = async (event: SubmitEvent) => {
		event.preventDefault();
		const text = this.composer;
		if (
			!text.trim() &&
			!this.images.length &&
			!this.attachments.length &&
			!this.reviewContexts.length
		)
			return;
		const sent = this.editingQueuedMessageId
			? await this.updateQueuedMessage(text)
			: isTurnBusy(this.options.session.delivery)
				? await this.queueMessage(text)
				: await this.sendText(text);
		if (sent) {
			this.composer = '';
			this.images = [];
			this.attachments = [];
			this.reviewContexts = [];
			this.editingQueuedMessageId = '';
			this.clearCurrentDraft();
		}
	};
	private async queueMessage(text: string): Promise<boolean> {
		const selectedSession = this.options.getSession();
		if (!selectedSession) return false;
		const messageId = crypto.randomUUID();
		try {
			const accepted = await this.options.api<{
				status: string;
				workMode: WorkMode;
				workModeChanged?: boolean;
				workModeEvent?: SessionEvent | null;
				consumed?: boolean;
			}>(this.sessionPath(selectedSession.sessionId, '/messages'), {
				method: 'POST',
				body: JSON.stringify({
					messageId,
					text,
					images: this.images,
					attachments: this.attachments,
					reviewContexts: this.reviewContexts
				})
			});
			this.options
				.getNavigation()
				.replaceSession({ ...selectedSession, workMode: accepted.workMode });
			if (accepted.workModeChanged || accepted.consumed) {
				this.messageNotice = formatWorkModeAnnouncement(accepted.workMode);
			}
			if (accepted.workModeEvent) this.options.session.previewEvents([accepted.workModeEvent]);
			if (!accepted.consumed) {
				this.options.session.queuedMessages = [
					...this.options.session.queuedMessages,
					{
						id: messageId,
						text,
						images: [...this.images],
						attachments: this.attachments.map(unavailableAttachmentMetadata),
						reviewContexts: [...this.reviewContexts],
						status: 'queued'
					}
				];
			}
			return true;
		} catch (cause) {
			this.report(cause);
			return false;
		}
	}

	private async updateQueuedMessage(text: string): Promise<boolean> {
		const selectedSession = this.options.getSession();
		if (!selectedSession || !this.editingQueuedMessageId) return false;
		try {
			const preserveAttachments =
				this.attachments.length > 0 &&
				this.attachments.every((attachment) => attachment.reattachRequired && !attachment.data);
			const body = await this.options.api<{ message: QueuedMessage }>(
				this.sessionPath(selectedSession.sessionId, '/messages'),
				{
					method: 'PATCH',
					body: JSON.stringify({
						messageId: this.editingQueuedMessageId,
						text,
						images: this.images,
						attachments: preserveAttachments ? undefined : this.attachments,
						preserveAttachments,
						reviewContexts: this.reviewContexts
					})
				}
			);
			this.options.session.queuedMessages = this.options.session.queuedMessages.map((message) =>
				message.id === this.editingQueuedMessageId ? body.message : message
			);
			return true;
		} catch (cause) {
			this.report(cause);
			return false;
		}
	}

	editQueuedMessage = async (message: QueuedMessage) => {
		this.editingQueuedMessageId = message.id;
		this.composer = message.text;
		this.images = [...message.images];
		this.attachments = [...(message.attachments ?? [])];
		this.reviewContexts = [...(message.reviewContexts ?? [])];
		await tick();
		this.composerElement?.focus();
	};

	copyMessage = async (message: TranscriptMessage) => {
		try {
			await navigator.clipboard.writeText(message.text);
			this.messageNotice = 'Message copied';
		} catch {
			this.messageNotice = 'Copy unavailable';
		}
	};
	copyCode = (code: string) => copyCode(code, (message) => (this.messageNotice = message));
	copyTable = (table: string) =>
		copyCode(table, (message) => (this.messageNotice = message), 'Table copied');

	respondToInteraction = async (
		interactionId: string,
		response:
			| { kind: 'permission'; optionId: string }
			| { kind: 'clarify'; action: 'accept'; content: Record<string, string | string[]> }
			| { kind: 'clarify'; action: 'cancel' }
	) => {
		const navigation = this.options.getNavigation();
		const selection = navigation.captureSessionSelection();
		if (!selection) return;
		const interactionPath = this.sessionPath(selection.sessionId, '/interactions');
		try {
			await this.options.api(interactionPath, {
				method: 'POST',
				body: JSON.stringify({ interactionId, response })
			});
			this.options.session.resolveInteraction(
				selection.projectId,
				selection.sessionId,
				interactionId,
				response.kind,
				response.kind === 'clarify' && response.action === 'cancel' ? 'cancelled' : 'resolved',
				navigation.isCurrentSessionSelection(selection)
			);
		} catch (cause) {
			if (navigation.isCurrentSessionSelection(selection)) this.report(cause);
		}
	};
	editMessage = async (message: TranscriptMessage) => {
		this.composer = message.text;
		this.images = [...(message.images ?? [])];
		this.attachments = (message.attachments ?? []).filter((attachment) => attachment.data);
		this.reviewContexts = [...(message.reviewContexts ?? [])];
		if ((message.attachments ?? []).some((attachment) => !attachment.data)) {
			this.options.setError('Attachment bytes are unavailable; reattach files before sending.');
		}
		this.saveCurrentDraft();
		await tick();
		this.composerElement?.focus();
	};
	openMedia = async (path: string, action: 'open' | 'reveal') => {
		const selectedSession = this.options.getSession();
		if (!selectedSession) return;
		try {
			await this.options.api(this.sessionPath(selectedSession.sessionId, '/media'), {
				method: 'POST',
				body: JSON.stringify({ path, action })
			});
			this.messageNotice =
				action === 'reveal'
					? 'Opened containing folder with generated file selected'
					: 'Opened generated file';
		} catch (cause) {
			this.report(cause);
		}
	};

	retryLastResponse = async () => {
		const messages = this.options.session.timeline.filter((item) => item.kind === 'message');
		const lastAssistant = messages.findLastIndex((message) => message.role === 'assistant');
		const user = messages.slice(0, lastAssistant).findLast((message) => message.role === 'user');
		if (!user) return;
		if ((user.attachments ?? []).some((attachment) => !attachment.data)) {
			this.options.setError('Attachment bytes are unavailable; reattach files before retrying.');
			return;
		}
		await this.sendText(
			user.text,
			user.images ?? [],
			user.attachments ?? [],
			user.reviewContexts ?? []
		);
	};

	stopTurn = async () => {
		const selectedSession = this.options.getSession();
		if (!selectedSession || this.stopping) return;
		this.stopping = true;
		try {
			await this.options.api(this.sessionPath(selectedSession.sessionId, '/cancel'), {
				method: 'POST'
			});
			this.options.session.delivery = 'cancelling';
		} catch (cause) {
			this.report(cause);
		} finally {
			this.stopping = false;
		}
	};

	sendText = async (
		text: string,
		imageAttachments: ImageAttachment[] = this.images,
		fileAttachments: InputAttachment[] = this.attachments,
		reviewContexts: ReviewContext[] = this.reviewContexts
	): Promise<boolean> => {
		const navigation = this.options.getNavigation();
		const selection = navigation.captureSessionSelection();
		const selectedProject = this.options.getProject();
		const selectedSession = this.options.getSession();
		const sessionState = this.options.session;
		if (!selection || !selectedSession || isTurnBusy(sessionState.delivery)) return false;
		const originPersistence = new MessagePersistence(
			() => selectedProject,
			() => selectedSession
		);
		if (fileAttachments.some((attachment) => !attachment.data)) {
			this.options.setError('Attachment bytes are unavailable; reattach files before sending.');
			return false;
		}
		const sendsCurrentDraft =
			this.composer === text &&
			JSON.stringify(this.images) === JSON.stringify(imageAttachments) &&
			JSON.stringify(this.attachments) === JSON.stringify(fileAttachments) &&
			JSON.stringify(this.reviewContexts) === JSON.stringify(reviewContexts);
		this.options.prepareVoice();
		const projectId = selection.projectId;
		const envelope =
			this.pendingEnvelope?.projectId === projectId &&
			this.pendingEnvelope.sessionId === selectedSession.sessionId &&
			this.pendingEnvelope.text === text &&
			JSON.stringify(this.pendingEnvelope.images) === JSON.stringify(imageAttachments) &&
			JSON.stringify(this.pendingEnvelope.attachments) === JSON.stringify(fileAttachments) &&
			JSON.stringify(this.pendingEnvelope.reviewContexts ?? []) === JSON.stringify(reviewContexts)
				? this.pendingEnvelope
				: {
						id: crypto.randomUUID(),
						projectId,
						sessionId: selectedSession.sessionId,
						text,
						images: imageAttachments,
						attachments: fileAttachments,
						reviewContexts
					};
		sessionState.activeMessageId = envelope.id;
		sessionState.pendingAssistant = '';
		sessionState.pendingImages = [];
		sessionState.pendingThought = '';
		sessionState.delivery = 'saving';
		navigation.setSessionBusySince(
			selectedSession.sessionId,
			new Date().toISOString(),
			selection.projectId
		);
		try {
			const accepted = await this.options.api<{
				duplicate: boolean;
				status: string;
				workMode: WorkMode;
				workModeChanged?: boolean;
				workModeEvent?: SessionEvent | null;
				consumed?: boolean;
			}>(this.sessionPath(selectedSession.sessionId, '/messages'), {
				method: 'POST',
				body: JSON.stringify({
					messageId: envelope.id,
					text: envelope.text,
					images: envelope.images,
					attachments: envelope.attachments,
					reviewContexts: envelope.reviewContexts
				})
			});
			originPersistence.pending(null);
			if (sendsCurrentDraft) {
				originPersistence.draft('');
				originPersistence.contexts([]);
			}
			const acceptedDelivery = accepted.consumed
				? ''
				: accepted.duplicate
					? accepted.status === 'queued'
						? 'accepted'
						: accepted.status === 'unknown'
							? 'delivery unknown'
							: accepted.status
					: 'accepted';
			sessionState.updateCachedDelivery(
				selection.projectId,
				selection.sessionId,
				accepted.consumed ? '' : envelope.id,
				acceptedDelivery
			);
			if (accepted.consumed)
				navigation.setSessionBusySince(selectedSession.sessionId, null, selection.projectId);
			if (!navigation.isCurrentSessionSelection(selection)) return false;
			navigation.replaceSession({ ...selectedSession, workMode: accepted.workMode });
			if (accepted.workModeChanged || accepted.consumed) {
				this.messageNotice = formatWorkModeAnnouncement(accepted.workMode);
			}
			if (accepted.workModeEvent) this.options.session.previewEvents([accepted.workModeEvent]);
			this.pendingEnvelope = null;
			this.clearPendingEnvelope();
			if (accepted.consumed) {
				sessionState.activeMessageId = '';
				sessionState.delivery = '';
				return true;
			}
			if (accepted.duplicate) {
				if (['completed', 'failed', 'unknown'].includes(accepted.status)) {
					if (!(await navigation.openSession(selectedSession))) return false;
					const refreshedSelection = navigation.captureSessionSelection();
					if (
						!refreshedSelection ||
						refreshedSelection.projectId !== selection.projectId ||
						refreshedSelection.sessionId !== selection.sessionId
					)
						return false;
					sessionState.delivery =
						accepted.status === 'unknown' ? 'delivery unknown' : accepted.status;
					return true;
				}
				sessionState.delivery = accepted.status === 'queued' ? 'accepted' : accepted.status;
				this.startPolling();
				return true;
			}
			const attachmentMetadata = envelope.attachments.map(unavailableAttachmentMetadata);
			sessionState.transcript = [
				...sessionState.transcript,
				{
					role: 'user',
					text,
					images: envelope.images,
					attachments: attachmentMetadata,
					reviewContexts: envelope.reviewContexts
				}
			];
			sessionState.timeline = [
				...sessionState.timeline,
				{
					sequence: Number.MAX_SAFE_INTEGER,
					kind: 'message',
					role: 'user',
					messageId: envelope.id,
					text,
					images: envelope.images,
					attachments: attachmentMetadata,
					reviewContexts: envelope.reviewContexts
				}
			];
			await this.options.transcriptFollow.scrollToLatest();
			if (!navigation.isCurrentSessionSelection(selection)) return false;
			sessionState.delivery = 'accepted';
			this.startPolling();
			return true;
		} catch (cause) {
			const uncertain = !(cause instanceof ApiError);
			if (uncertain) originPersistence.pending(envelope);
			else originPersistence.pending(null);
			sessionState.updateCachedDelivery(
				selection.projectId,
				selection.sessionId,
				uncertain ? envelope.id : '',
				uncertain ? 'delivery unknown' : 'not accepted'
			);
			navigation.setSessionBusySince(selectedSession.sessionId, null, selection.projectId);
			if (!navigation.isCurrentSessionSelection(selection)) return false;
			this.pendingEnvelope = uncertain ? envelope : null;
			sessionState.activeMessageId = uncertain ? envelope.id : '';
			sessionState.delivery = uncertain ? 'delivery unknown' : 'not accepted';
			this.report(cause);
			return false;
		}
	};
	retryPendingMessage = async () => {
		if (!this.pendingEnvelope || isTurnBusy(this.options.session.delivery)) return;
		if (
			await this.sendText(
				this.pendingEnvelope.text,
				this.pendingEnvelope.images,
				this.pendingEnvelope.attachments,
				this.pendingEnvelope.reviewContexts ?? []
			)
		) {
			this.composer = '';
			this.images = [];
			this.attachments = [];
			this.reviewContexts = [];
			this.clearCurrentDraft();
		}
	};
	saveCurrentDraft = () => {
		this.persistence.draft(this.composer);
	};
	restoreDraft = () => {
		this.composer = this.persistence.draft();
		this.reviewContexts = this.persistence.contexts();
		this.pendingEnvelope = this.persistence.pending();
	};
	private clearPendingEnvelope() {
		this.persistence.pending(null);
	}
	private clearCurrentDraft() {
		this.persistence.draft('');
		this.persistence.contexts([]);
	}
	addReviewContext = (seed: ReviewContextSeed) => {
		try {
			this.reviewContexts = validateReviewContexts([
				...this.reviewContexts,
				{
					...seed,
					id: crypto.randomUUID(),
					content: seed.content.slice(0, reviewContextLimits.maxContentChars),
					comment: ''
				}
			]);
			this.persistence.contexts(this.reviewContexts);
			this.messageNotice = 'Review context added';
			this.options.focusComposer();
		} catch (cause) {
			this.report(cause);
		}
	};
	updateReviewComment = (id: string, comment: string) => {
		try {
			this.reviewContexts = validateReviewContexts(
				this.reviewContexts.map((context) =>
					context.id === id ? { ...context, comment } : context
				)
			);
			this.persistence.contexts(this.reviewContexts);
		} catch (cause) {
			this.report(cause);
		}
	};
	removeReviewContext = (id: string) => {
		this.reviewContexts = this.reviewContexts.filter((context) => context.id !== id);
		this.persistence.contexts(this.reviewContexts);
	};
	promptImproving = $state(false);
	improvePrompt = async (
		answers: PromptImprovementAnswer[],
		modelId?: string
	): Promise<PromptImprovementResult | null> => {
		const navigation = this.options.getNavigation();
		const selection = navigation.captureSessionSelection();
		const text = this.composer;
		if (!selection || !text.trim() || this.promptImproving) return null;
		const identity = JSON.stringify([selection.projectId, selection.sessionId, text, answers, modelId]);
		if (this.promptImprovementOperation?.identity !== identity) {
			this.promptImprovementOperation = { identity, id: crypto.randomUUID() };
		}
		this.promptImproving = true;
		try {
			const result = await this.options.api<PromptImprovementResult>(
				this.sessionPath(selection.sessionId, '/prompt-improvement'),
				{
					method: 'POST',
					body: JSON.stringify({
						text,
						answers,
						modelId,
						operationId: this.promptImprovementOperation.id
					})
				}
			);
			if (result.status !== 'pending') this.promptImprovementOperation = null;
			return navigation.isCurrentSessionSelection(selection) ? result : null;
		} catch (cause) {
			if (navigation.isCurrentSessionSelection(selection)) this.report(cause);
			return null;
		} finally {
			this.promptImproving = false;
		}
	};
	updateDraft = (event: Event) => {
		this.composer = (event.currentTarget as HTMLTextAreaElement).value;
		this.commandIndex = 0;
		this.saveCurrentDraft();
	};
	matchingCommands = () => {
		const match = this.composer.match(/^\/([^\s]*)$/);
		if (!match) return [];
		return this.options.session.commands.filter(({ name }) =>
			name.toLowerCase().startsWith(match[1].toLowerCase())
		);
	};
	chooseCommand = (command: HermesCommand) => {
		this.composer = `/${command.name} `;
		this.commandIndex = 0;
		this.saveCurrentDraft();
	};
	handleComposerKeydown = (event: KeyboardEvent) => {
		const matches = this.matchingCommands();
		const sendKey =
			document.documentElement.dataset.sendKey === 'mod-enter' ? 'mod-enter' : 'enter';
		const sendNow = sendKey === 'mod-enter' && shouldSendMessage(event, sendKey);
		if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			this.commandIndex = (this.commandIndex + step + matches.length) % matches.length;
			return;
		}
		if (matches.length && (event.key === 'Tab' || (event.key === 'Enter' && !sendNow))) {
			event.preventDefault();
			this.chooseCommand(matches[this.commandIndex] ?? matches[0]);
			return;
		}
		if (shouldSendMessage(event, sendKey)) {
			event.preventDefault();
			(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
		}
	};
	addFiles = async (files: FileList | File[]) => {
		const result = await readAttachmentFiles(files);
		const imagePrompts = this.options.session.runtime.capabilities?.promptImage === true;
		this.images = [...this.images, ...(imagePrompts ? result.images : [])];
		this.attachments = [
			...this.attachments.filter((attachment) => attachment.data),
			...result.attachments
		];
		this.options.setError(
			!imagePrompts && result.images.length
				? 'Hermes does not support image prompts'
				: (result.errors.at(-1) ?? '')
		);
	};
	handleImageInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files) void this.addFiles(input.files);
		input.value = '';
	};
	handleDrop = (event: DragEvent) => {
		event.preventDefault();
		this.draggingImages = false;
		if (event.dataTransfer?.files) void this.addFiles(event.dataTransfer.files);
	};

	handlePaste = (event: ClipboardEvent) => {
		const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
			file.type.startsWith('image/')
		);
		if (files.length) void this.addFiles(files);
	};

	startPolling = () => {
		this.stopPolling();
		void this.syncEvents();
		this.pollTimer = setInterval(() => void this.syncEvents(), 650);
	};

	stopPolling = () => {
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = null;
	};

	private async syncEvents() {
		const selectedSession = this.options.getSession();
		if (!selectedSession) return;
		const projectId = this.options.getProject()?.id ?? null;
		const sessionId = selectedSession.sessionId;
		const eventsPath = this.sessionPath(
			sessionId,
			`/events?after=${this.options.session.eventCursor}`
		);
		await runSingleFlight(this.pollFlight, async () => {
			try {
				const body = await this.options.api<{ events: SessionEvent[]; runtime?: HermesRuntime }>(
					eventsPath
				);
				if (
					(this.options.getProject()?.id ?? null) !== projectId ||
					this.options.getSession()?.sessionId !== sessionId
				)
					return;
				const state = this.options.session;
				this.options.applyVoiceEvents(body.events, state.activeMessageId);
				if (state.applyEvents(body.events)) this.options.transcriptFollow.settle();
				this.options.getNavigation().applySessionInfoEvents(body.events);
				if (body.runtime) state.runtime = { ...state.runtime, ...body.runtime };
				if (!isTurnBusy(state.delivery)) {
					this.options.getNavigation().setSessionBusySince(sessionId, null);
					await this.options.getNavigation().loadActiveTab();
					if (state.queuedMessages.length && this.options.getSession()) {
						await this.options.getNavigation().openSession(this.options.getSession()!);
					} else this.stopPolling();
				}
			} catch {
				if (
					(this.options.getProject()?.id ?? null) === projectId &&
					this.options.getSession()?.sessionId === sessionId
				)
					this.options.session.delivery = 'reconnecting';
			}
		});
	}

	private report(cause: unknown) {
		this.options.setError(cause instanceof Error ? cause.message : String(cause));
	}
}
