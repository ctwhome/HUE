import { tick } from 'svelte';
import { applySessionEvents, isTurnBusy, runSingleFlight } from '$lib';
import type { ImageAttachment } from '$lib/message-content';
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
	draggingImages = $state(false);
	pendingEnvelope = $state<PendingEnvelope | null>(null);
	editingQueuedMessageId = $state('');
	commandIndex = $state(0);
	messageNotice = $state('');
	stopping = $state(false);
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private pollFlight: { current: Promise<void> | null } = { current: null };

	constructor(private options: MessageStateOptions) {}

	private sessionPath(sessionId: string, suffix = '') {
		return this.options.getNavigation().sessionApiPath(sessionId, suffix);
	}

	clear = () => {
		this.pendingEnvelope = null;
		this.editingQueuedMessageId = '';
		this.images = [];
	};

	submit = async (event: SubmitEvent) => {
		event.preventDefault();
		const text = this.composer;
		if (!text.trim() && !this.images.length) return;
		const sent = this.editingQueuedMessageId
			? await this.updateQueuedMessage(text)
			: isTurnBusy(this.options.session.delivery)
				? await this.queueMessage(text)
				: await this.sendText(text);
		if (sent) {
			this.composer = '';
			this.images = [];
			this.editingQueuedMessageId = '';
			this.clearCurrentDraft();
		}
	};

	private async queueMessage(text: string): Promise<boolean> {
		const selectedSession = this.options.getSession();
		if (!selectedSession) return false;
		const messageId = crypto.randomUUID();
		try {
			await this.options.api<{ status: string }>(
				this.sessionPath(selectedSession.sessionId, '/messages'),
				{ method: 'POST', body: JSON.stringify({ messageId, text, images: this.images }) }
			);
			this.options.session.queuedMessages = [
				...this.options.session.queuedMessages,
				{ id: messageId, text, images: [...this.images], status: 'queued' }
			];
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
			const body = await this.options.api<{ message: QueuedMessage }>(
				this.sessionPath(selectedSession.sessionId, '/messages'),
				{
					method: 'PATCH',
					body: JSON.stringify({
						messageId: this.editingQueuedMessageId,
						text,
						images: this.images
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

	editMessage = async (message: TranscriptMessage) => {
		this.composer = message.text;
		this.images = [...(message.images ?? [])];
		this.saveCurrentDraft();
		await tick();
		this.composerElement?.focus();
	};

	forkSession = async () => {
		const selectedSession = this.options.getSession();
		if (!selectedSession || isTurnBusy(this.options.session.delivery)) return;
		const projectId = this.options.getProject()?.id ?? null;
		const sessionId = selectedSession.sessionId;
		this.options.setLoading(true);
		this.options.setError('');
		try {
			const body = await this.options.api<{ session: Session }>(this.sessionPath(sessionId), {
				method: 'POST'
			});
			if (
				(this.options.getProject()?.id ?? null) !== projectId ||
				this.options.getSession()?.sessionId !== sessionId
			)
				return;
			this.options.getNavigation().prependSession(body.session);
			await this.options.getNavigation().openSession(body.session);
		} catch (cause) {
			this.report(cause);
		} finally {
			this.options.setLoading(false);
		}
	};

	stopTurn = async () => {
		const selectedSession = this.options.getSession();
		if (!selectedSession || this.stopping) return;
		this.stopping = true;
		try {
			await this.options.api(this.sessionPath(selectedSession.sessionId, '/cancel'), {
				method: 'POST'
			});
		} catch (cause) {
			this.report(cause);
		} finally {
			this.stopping = false;
		}
	};

	sendText = async (
		text: string,
		attachments: ImageAttachment[] = this.images
	): Promise<boolean> => {
		const selectedSession = this.options.getSession();
		const sessionState = this.options.session;
		if (!selectedSession || isTurnBusy(sessionState.delivery)) return false;
		this.options.prepareVoice();
		const projectId = this.options.getProject()?.id ?? null;
		const envelope =
			this.pendingEnvelope?.projectId === projectId &&
			this.pendingEnvelope.sessionId === selectedSession.sessionId &&
			this.pendingEnvelope.text === text
				? this.pendingEnvelope
				: {
						id: crypto.randomUUID(),
						projectId,
						sessionId: selectedSession.sessionId,
						text,
						images: attachments
					};
		sessionState.activeMessageId = envelope.id;
		sessionState.pendingAssistant = '';
		sessionState.pendingImages = [];
		sessionState.pendingThought = '';
		sessionState.delivery = 'saving';
		this.options
			.getNavigation()
			.setSessionBusySince(selectedSession.sessionId, new Date().toISOString());
		try {
			const accepted = await this.options.api<{ duplicate: boolean; status: string }>(
				this.sessionPath(selectedSession.sessionId, '/messages'),
				{
					method: 'POST',
					body: JSON.stringify({
						messageId: envelope.id,
						text: envelope.text,
						images: envelope.images
					})
				}
			);
			this.pendingEnvelope = null;
			this.clearPendingEnvelope();
			if (accepted.duplicate) {
				if (['completed', 'failed', 'unknown'].includes(accepted.status)) {
					await this.options.getNavigation().openSession(selectedSession);
					sessionState.delivery =
						accepted.status === 'unknown' ? 'delivery unknown' : accepted.status;
					return true;
				}
				sessionState.delivery = accepted.status === 'queued' ? 'accepted' : accepted.status;
				this.startPolling();
				return true;
			}
			sessionState.transcript = [
				...sessionState.transcript,
				{ role: 'user', text, images: envelope.images }
			];
			await this.options.transcriptFollow.scrollToLatest();
			sessionState.delivery = 'accepted';
			this.startPolling();
			return true;
		} catch (cause) {
			const uncertain = !(cause instanceof ApiError);
			this.pendingEnvelope = uncertain ? envelope : null;
			if (uncertain) this.savePendingEnvelope(envelope);
			else this.clearPendingEnvelope();
			sessionState.activeMessageId = uncertain ? envelope.id : '';
			sessionState.delivery = uncertain ? 'delivery unknown' : 'not accepted';
			this.options.getNavigation().setSessionBusySince(selectedSession.sessionId, null);
			this.report(cause);
			return false;
		}
	};

	retryPendingMessage = async () => {
		if (!this.pendingEnvelope || isTurnBusy(this.options.session.delivery)) return;
		if (await this.sendText(this.pendingEnvelope.text, this.pendingEnvelope.images)) {
			this.composer = '';
			this.images = [];
			this.clearCurrentDraft();
		}
	};

	private storageKey(kind: 'draft' | 'pending') {
		const selectedSession = this.options.getSession();
		return selectedSession
			? `hue:${kind}:${this.options.getProject()?.id ?? 'none'}:${selectedSession.sessionId}`
			: '';
	}

	saveCurrentDraft = () => {
		const key = this.storageKey('draft');
		if (!key) return;
		if (this.composer) localStorage.setItem(key, this.composer);
		else localStorage.removeItem(key);
	};

	restoreDraft = () => {
		const key = this.storageKey('draft');
		this.composer = key ? (localStorage.getItem(key) ?? '') : '';
		const pending = this.storageKey('pending');
		try {
			const saved = pending
				? (JSON.parse(localStorage.getItem(pending) ?? 'null') as PendingEnvelope | null)
				: null;
			this.pendingEnvelope = saved ? { ...saved, images: saved.images ?? [] } : null;
		} catch {
			this.pendingEnvelope = null;
			if (pending) localStorage.removeItem(pending);
		}
	};

	private savePendingEnvelope(envelope: PendingEnvelope) {
		const key = this.storageKey('pending');
		if (key) localStorage.setItem(key, JSON.stringify(envelope));
	}

	private clearPendingEnvelope() {
		const key = this.storageKey('pending');
		if (key) localStorage.removeItem(key);
	}

	private clearCurrentDraft() {
		const key = this.storageKey('draft');
		if (key) localStorage.removeItem(key);
	}

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
		if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			this.commandIndex = (this.commandIndex + step + matches.length) % matches.length;
			return;
		}
		if (matches.length && (event.key === 'Tab' || event.key === 'Enter')) {
			event.preventDefault();
			this.chooseCommand(matches[this.commandIndex] ?? matches[0]);
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
		}
	};

	addImageFiles = async (files: FileList | File[]) => {
		for (const file of Array.from(files).slice(0, 4 - this.images.length)) {
			if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
				this.options.setError('Only PNG, JPEG, GIF, and WebP images are supported');
				continue;
			}
			if (file.size > 10 * 1024 * 1024) {
				this.options.setError('Each image must be 10 MB or smaller');
				continue;
			}
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result));
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});
			this.images = [
				...this.images,
				{ name: file.name, mimeType: file.type, data: dataUrl.split(',')[1] }
			];
		}
	};

	handleImageInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files) void this.addImageFiles(input.files);
		input.value = '';
	};

	handleDrop = (event: DragEvent) => {
		event.preventDefault();
		this.draggingImages = false;
		if (event.dataTransfer?.files) void this.addImageFiles(event.dataTransfer.files);
	};

	handlePaste = (event: ClipboardEvent) => {
		const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
			file.type.startsWith('image/')
		);
		if (files.length) void this.addImageFiles(files);
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
				const next = applySessionEvents(
					{
						cursor: state.eventCursor,
						activeMessageId: state.activeMessageId,
						pendingAssistant: state.pendingAssistant,
						pendingImages: state.pendingImages,
						pendingThought: state.pendingThought,
						delivery: state.delivery,
						transcript: state.transcript,
						subagents: state.subagents
					},
					body.events
				);
				const wasBusy = isTurnBusy(state.delivery);
				state.eventCursor = next.cursor;
				state.pendingAssistant = next.pendingAssistant;
				state.pendingImages = next.pendingImages ?? [];
				state.pendingThought = next.pendingThought ?? '';
				state.delivery = next.delivery;
				if (wasBusy && !isTurnBusy(state.delivery)) this.options.transcriptFollow.settle();
				state.transcript = next.transcript;
				state.subagents = next.subagents ?? [];
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
