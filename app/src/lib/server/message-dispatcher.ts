import type { HUEStore } from './store';
import type { ImageAttachment } from '$lib/message-content';

export interface PromptRuntime {
	resumeSession(cwd: string, sessionId: string): Promise<void>;
	prompt(input: {
		sessionId: string;
		text: string;
		images: ImageAttachment[];
		onChunk: (text: string) => void;
	}): Promise<void>;
}

export type MessageEnvelope = {
	id: string;
	projectId: string;
	sessionId: string;
	text: string;
	images?: ImageAttachment[];
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
		if (accepted.duplicate) return accepted;

		this.enqueue(envelope);
		return accepted;
	}

	private enqueue(envelope: MessageEnvelope, resumeCwd?: string) {
		if (this.recovering.has(envelope.id)) return;
		this.recovering.add(envelope.id);
		const preceding = this.queues.get(envelope.sessionId) ?? Promise.resolve();
		const pending = preceding.then(() => this.process(envelope, resumeCwd));
		this.queues.set(envelope.sessionId, pending);
		void pending.finally(() => {
			this.recovering.delete(envelope.id);
			if (this.queues.get(envelope.sessionId) === pending) {
				this.queues.delete(envelope.sessionId);
			}
		});
	}

	async whenIdle(sessionId: string): Promise<void> {
		await (this.queues.get(sessionId) ?? Promise.resolve());
	}

	private async process(envelope: MessageEnvelope, resumeCwd?: string): Promise<void> {
		try {
			if (resumeCwd) await this.runtime.resumeSession(resumeCwd, envelope.sessionId);
			this.store.transitionMessage(envelope.id, 'running', {
				messageId: envelope.id
			});
			await this.runtime.prompt({
				sessionId: envelope.sessionId,
				text: envelope.text,
				images: envelope.images ?? [],
				onChunk: (text) => {
					this.store.appendEvent(envelope.projectId, envelope.sessionId, 'agent.chunk', {
						messageId: envelope.id,
						text
					});
				}
			});
			this.store.transitionMessage(envelope.id, 'completed', {
				messageId: envelope.id
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const uncertain =
				this.store.getMessage(envelope.id)?.status === 'running' &&
				error instanceof DeliveryUncertainError;
			const status = uncertain ? 'unknown' : 'failed';
			this.store.transitionMessage(envelope.id, status, {
				messageId: envelope.id,
				error: message
			});
		}
	}
}
