import type { HUEStore } from './store';
import type { ImageAttachment, InputAttachment } from '$lib/message-content';
import { DEFAULT_WORK_MODE, type WorkMode } from '$lib/work-mode';

export type SubagentChild = {
	index: number;
	goal: string;
	role?: string;
	status: string;
	result?: string;
};

export type SubagentTree = {
	id: string;
	title: string;
	status: string;
	children: SubagentChild[];
};

export type ToolCall = {
	id: string;
	name: string;
	title: string;
	kind: string;
	status: string;
	args?: unknown;
	result?: unknown;
	error?: string;
	startedAt: number;
	completedAt?: number;
	durationMs?: number;
};

export type PlanEntry = {
	content: string;
	priority: string;
	status: string;
};

export type PermissionOption = { optionId: string; name: string; kind: string };
export type ClarifyField = {
	name: string;
	label: string;
	control: 'single' | 'multi' | 'text';
	required: boolean;
	options?: Array<{ value: string; label: string }>;
};
export type InteractionRequest =
	| {
			kind: 'permission';
			id: string;
			sessionId: string;
			toolCall: ToolCall;
			options: PermissionOption[];
	  }
	| {
			kind: 'clarify';
			id: string;
			sessionId: string;
			message: string;
			fields: ClarifyField[];
	  };
export type InteractionReply =
	| { outcome: { outcome: 'cancelled' | 'selected'; optionId?: string } }
	| { action: 'accept'; content: Record<string, string | string[]> }
	| { action: 'cancel' };
export type BrowserInteractionResponse =
	| { kind: 'permission'; optionId: string }
	| { kind: 'clarify'; action: 'accept'; content: Record<string, string | string[]> }
	| { kind: 'clarify'; action: 'cancel' };

export interface PromptRuntime {
	resumeSession(cwd: string, sessionId: string): Promise<void>;
	prompt(input: {
		sessionId: string;
		text: string;
		images: ImageAttachment[];
		attachments?: InputAttachment[];
		workMode: WorkMode;
		onChunk: (text: string) => void;
		onImage?: (image: ImageAttachment) => void;
		onThought?: (text: string) => void;
		onTool?: (update: ToolCall) => void;
		onPlan?: (entries: PlanEntry[]) => void;
		onInteraction?: (request: InteractionRequest) => Promise<InteractionReply>;
		onSubagent?: (update: SubagentTree) => void;
	}): Promise<void>;
}

export type MessageEnvelope = {
	id: string;
	projectId: string | null;
	sessionId: string;
	text: string;
	images?: ImageAttachment[];
	attachments?: InputAttachment[];
};

export class DeliveryUncertainError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DeliveryUncertainError';
	}
}

export class MessageDispatcher {
	private readonly queues = new Map<string, Promise<void>>();
	private readonly recovering = new Set<string>();
	private readonly turnAttachments = new Map<string, InputAttachment[]>();
	private readonly interactions = new Map<
		string,
		{
			request: InteractionRequest;
			messageId: string;
			projectId: string | null;
			resolve: (reply: InteractionReply) => void;
		}
	>();

	constructor(
		private readonly store: HUEStore,
		private readonly runtime: PromptRuntime
	) {
		this.recover();
	}

	recover(): void {
		for (const message of this.store.recoverInterruptedMessages(this.recovering)) {
			this.enqueue(message, message.cwd);
		}
	}

	submit(envelope: MessageEnvelope) {
		const accepted = this.store.acceptMessage(envelope);
		const workMode = (this.store.getSession(envelope.projectId, envelope.sessionId)?.workMode ??
			DEFAULT_WORK_MODE) as WorkMode;
		if (accepted.duplicate) return { ...accepted, workMode };
		if (envelope.attachments?.length) this.turnAttachments.set(envelope.id, envelope.attachments);

		this.enqueue(envelope);
		return { ...accepted, workMode };
	}

	updateQueuedMessage(id: string, input: Parameters<HUEStore['updateQueuedMessage']>[1]) {
		if (input.attachments === undefined && !this.turnAttachments.has(id)) {
			throw new Error('Attachments unavailable after restart; reattach required');
		}
		const message = this.store.updateQueuedMessage(id, input);
		if (input.attachments !== undefined) {
			input.attachments.length
				? this.turnAttachments.set(id, input.attachments)
				: this.turnAttachments.delete(id);
		}
		return message;
	}

	private enqueue(envelope: MessageEnvelope, resumeCwd?: string) {
		if (this.recovering.has(envelope.id)) return;
		this.recovering.add(envelope.id);
		const pending = this.withSessionLock(envelope.sessionId, () =>
			this.process(envelope, resumeCwd)
		);
		void pending.finally(() => {
			this.recovering.delete(envelope.id);
		});
	}

	withSessionLock<T>(sessionId: string, operation: () => Promise<T> | T): Promise<T> {
		const preceding = this.queues.get(sessionId) ?? Promise.resolve();
		const pending = preceding.then(operation);
		const tail = pending.then(
			() => undefined,
			() => undefined
		);
		this.queues.set(sessionId, tail);
		void tail.finally(() => {
			if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId);
		});
		return pending;
	}

	async whenIdle(sessionId: string): Promise<void> {
		await (this.queues.get(sessionId) ?? Promise.resolve());
	}

	resolveInteraction(
		projectId: string | null,
		sessionId: string,
		id: string,
		response: BrowserInteractionResponse
	): boolean {
		const key = `${sessionId}\0${id}`;
		const pending = this.interactions.get(key);
		if (
			!pending ||
			pending.projectId !== projectId ||
			pending.request.sessionId !== sessionId ||
			pending.request.kind !== response.kind
		)
			return false;
		if (response.kind === 'permission' && pending.request.kind === 'permission') {
			if (typeof response.optionId !== 'string') return false;
			if (!pending.request.options.some((option) => option.optionId === response.optionId))
				return false;
			this.interactions.delete(key);
			this.store.appendEvent(projectId, sessionId, 'agent.permission', {
				id,
				messageId: pending.messageId,
				status: 'resolved',
				decision: response.optionId
			});
			pending.resolve({ outcome: { outcome: 'selected', optionId: response.optionId } });
			return true;
		}
		if (response.kind !== 'clarify' || pending.request.kind !== 'clarify') return false;
		if (response.action !== 'accept' && response.action !== 'cancel') return false;
		if (
			response.action === 'accept' &&
			(!response.content || !validClarifyContent(pending.request.fields, response.content))
		)
			return false;
		this.interactions.delete(key);
		this.store.appendEvent(projectId, sessionId, 'agent.clarify', {
			id,
			messageId: pending.messageId,
			status: response.action === 'cancel' ? 'cancelled' : 'resolved'
		});
		pending.resolve(
			response.action === 'cancel'
				? { action: 'cancel' }
				: { action: 'accept', content: response.content }
		);
		return true;
	}

	private requestInteraction(
		projectId: string | null,
		messageId: string,
		request: InteractionRequest
	): Promise<InteractionReply> {
		const type = request.kind === 'permission' ? 'agent.permission' : 'agent.clarify';
		this.store.appendEvent(projectId, request.sessionId, type, {
			...request,
			messageId,
			status: 'pending'
		});
		return new Promise((resolve) =>
			this.interactions.set(`${request.sessionId}\0${request.id}`, {
				request,
				messageId,
				projectId,
				resolve
			})
		);
	}

	private cancelInteractions(messageId: string): void {
		for (const [key, pending] of this.interactions) {
			if (pending.messageId !== messageId) continue;
			this.interactions.delete(key);
			this.store.appendEvent(
				pending.projectId,
				pending.request.sessionId,
				pending.request.kind === 'permission' ? 'agent.permission' : 'agent.clarify',
				{ id: pending.request.id, messageId, status: 'cancelled' }
			);
			pending.resolve(
				pending.request.kind === 'permission'
					? { outcome: { outcome: 'cancelled' } }
					: { action: 'cancel' }
			);
		}
	}

	private async process(envelope: MessageEnvelope, resumeCwd?: string): Promise<void> {
		try {
			const queued = this.store.getMessage(envelope.id);
			if (!queued || queued.status !== 'queued') return;
			const attachments = this.turnAttachments.get(envelope.id);
			if (queued.attachments.length && !attachments?.length) {
				throw new Error('Attachments unavailable after restart; reattach required');
			}
			if (resumeCwd) await this.runtime.resumeSession(resumeCwd, envelope.sessionId);
			const current = {
				...envelope,
				text: queued.text,
				images: queued.images,
				attachments: attachments ?? [],
				workMode: (this.store.getSession(envelope.projectId, envelope.sessionId)?.workMode ??
					DEFAULT_WORK_MODE) as WorkMode
			};
			this.store.transitionMessage(current.id, 'running', {
				messageId: envelope.id
			});
			await this.runtime.prompt({
				sessionId: current.sessionId,
				text: current.text,
				images: current.images ?? [],
				attachments: current.attachments ?? [],
				workMode: current.workMode,
				onChunk: (text) => {
					this.store.appendEvent(envelope.projectId, envelope.sessionId, 'agent.chunk', {
						messageId: envelope.id,
						text
					});
				},
				onImage: (image) => {
					this.store.appendEvent(envelope.projectId, envelope.sessionId, 'agent.image', {
						messageId: envelope.id,
						image
					});
				},
				onThought: (text) => {
					this.store.appendEvent(envelope.projectId, envelope.sessionId, 'agent.thought', {
						messageId: envelope.id,
						text
					});
				},
				onTool: (update) => {
					this.store.appendEvent(envelope.projectId, envelope.sessionId, 'agent.tool', {
						messageId: envelope.id,
						...update
					});
				},
				onPlan: (entries) => {
					this.store.appendEvent(envelope.projectId, envelope.sessionId, 'agent.plan', {
						messageId: envelope.id,
						entries
					});
				},
				onInteraction: (request) =>
					this.requestInteraction(envelope.projectId, envelope.id, request),
				onSubagent: (update) => {
					this.store.appendEvent(envelope.projectId, envelope.sessionId, 'agent.subagents', {
						messageId: envelope.id,
						...update
					});
				}
			});
			this.cancelInteractions(envelope.id);
			this.store.transitionMessage(envelope.id, 'completed', {
				messageId: envelope.id
			});
		} catch (error) {
			this.cancelInteractions(envelope.id);
			const message = error instanceof Error ? error.message : String(error);
			const uncertain =
				this.store.getMessage(envelope.id)?.status === 'running' &&
				error instanceof DeliveryUncertainError;
			const status = uncertain ? 'unknown' : 'failed';
			this.store.transitionMessage(envelope.id, status, {
				messageId: envelope.id,
				error: message
			});
		} finally {
			this.turnAttachments.delete(envelope.id);
		}
	}
}

function validClarifyContent(
	fields: ClarifyField[],
	content: Record<string, string | string[]>
): boolean {
	if (Object.keys(content).some((name) => !fields.some((field) => field.name === name)))
		return false;
	return fields.every((field) => {
		const value = content[field.name];
		if (value === undefined) return !field.required;
		if (field.control === 'multi') {
			return (
				Array.isArray(value) &&
				value.length <= 200 &&
				value.every((item) => field.options?.some((option) => option.value === item))
			);
		}
		if (typeof value !== 'string' || value.length > 10_000) return false;
		return field.control !== 'single' || !!field.options?.some((option) => option.value === value);
	});
}
