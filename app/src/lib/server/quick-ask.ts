import type { MessageEnvelope } from './message-dispatcher';
import type { HUEStore, StoredSession } from './store';
import { createHash } from 'node:crypto';

export type QuickAskResult = {
	status: 'completed' | 'pending' | 'failed' | 'unknown';
	sessionId: string;
	messageId: string;
	answer?: string;
	path?: string;
	error?: string;
};

type QuickAskRuntime = {
	createSession(cwd: string): Promise<{ sessionId: string; cwd: string }>;
	cancelSession(sessionId: string): Promise<unknown>;
};

type QuickAskDispatcher = {
	submit(envelope: MessageEnvelope): unknown;
	whenIdle(sessionId: string): Promise<void>;
};

const activeQuickAsks = new Map<string, { identity: string; promise: Promise<QuickAskResult> }>();

export function quickAskPrompt(question: string): string {
	if (!question.trim() || question.length > 20_000)
		throw new Error('Question must be between 1 and 20,000 characters');
	return question;
}

export function generateQuickAsk(
	input: { question: string; operationId: string; sessionRoot: string },
	dependencies: {
		store: HUEStore;
		runtime: QuickAskRuntime;
		dispatcher: QuickAskDispatcher;
		waitTimeoutMs?: number;
	}
): Promise<QuickAskResult> {
	const identity = JSON.stringify([input.question, input.sessionRoot]);
	const active = activeQuickAsks.get(input.operationId);
	if (active) {
		return active.identity === identity
			? active.promise
			: Promise.reject(new Error('Quick Ask operation id is already in use'));
	}
	const quickAsk = runQuickAsk(input, dependencies);
	activeQuickAsks.set(input.operationId, { identity, promise: quickAsk });
	const clear = () => {
		if (activeQuickAsks.get(input.operationId)?.promise === quickAsk)
			activeQuickAsks.delete(input.operationId);
	};
	void quickAsk.then(clear, clear);
	return quickAsk;
}

async function runQuickAsk(
	input: { question: string; operationId: string; sessionRoot: string },
	dependencies: {
		store: HUEStore;
		runtime: QuickAskRuntime;
		dispatcher: QuickAskDispatcher;
		waitTimeoutMs?: number;
	}
): Promise<QuickAskResult> {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(input.operationId))
		throw new Error('Invalid Quick Ask operation id');
	const prompt = quickAskPrompt(input.question);
	const questionHash = createHash('sha256').update(prompt).digest('hex');
	const reservation = dependencies.store.reserveQuickAsk(input.operationId, questionHash);
	if (!reservation.created) {
		if (reservation.quickAsk.questionHash !== questionHash)
			throw new Error('Quick Ask operation id is already in use');
		const existing = dependencies.store.getMessage(input.operationId);
		if (!reservation.quickAsk.sessionId || !existing) {
			return {
				status: 'unknown',
				error: 'Quick Ask creation was interrupted before delivery could be confirmed',
				sessionId: reservation.quickAsk.sessionId ?? '',
				messageId: input.operationId
			};
		}
		return waitForQuickAsk(
			dependencies.store,
			dependencies.dispatcher,
			reservation.quickAsk.sessionId,
			input.operationId,
			dependencies.waitTimeoutMs
		);
	}

	let session: { sessionId: string; cwd: string } | null = null;
	try {
		session = await dependencies.runtime.createSession(input.sessionRoot);
		dependencies.store.attachQuickAsk(input.operationId, session.sessionId);
		if (session.cwd !== input.sessionRoot)
			throw new Error('Hermes created the Quick Ask Session outside the temporary folder');
		dependencies.store.upsertSession(null, { ...session, title: 'Quick Ask' });
		dependencies.store.updateSession(null, session.sessionId, { archived: true });
		dependencies.dispatcher.submit({
			id: input.operationId,
			projectId: null,
			sessionId: session.sessionId,
			text: prompt,
			images: [],
			attachments: [],
			reviewContexts: []
		});
	} catch (cause) {
		if (session) {
			try {
				await dependencies.runtime.cancelSession(session.sessionId);
				dependencies.store.dismissQuickAsk(input.operationId);
			} catch (cleanupCause) {
				return {
					status: 'unknown',
					error: cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause),
					sessionId: session.sessionId,
					messageId: input.operationId
				};
			}
		} else {
			return {
				status: 'unknown',
				error: cause instanceof Error ? cause.message : String(cause),
				sessionId: '',
				messageId: input.operationId
			};
		}
		return {
			status: 'failed',
			error: cause instanceof Error ? cause.message : String(cause),
			sessionId: session?.sessionId ?? '',
			messageId: input.operationId
		};
	}
	return waitForQuickAsk(
		dependencies.store,
		dependencies.dispatcher,
		session.sessionId,
		input.operationId,
		dependencies.waitTimeoutMs
	);
}

async function waitForQuickAsk(
	store: HUEStore,
	dispatcher: QuickAskDispatcher,
	sessionId: string,
	messageId: string,
	waitTimeoutMs = 10_000
): Promise<QuickAskResult> {
	const stored = store.getMessage(messageId);
	if (!stored) throw new Error('Quick Ask message was not persisted');
	if (stored.status === 'queued' || stored.status === 'running') {
		const idle = await Promise.race([
			dispatcher.whenIdle(sessionId).then(() => true),
			Bun.sleep(waitTimeoutMs).then(() => false)
		]);
		if (!idle) {
			return {
				status: 'pending',
				sessionId,
				messageId,
				path: `/?project=none&session=${encodeURIComponent(sessionId)}`
			};
		}
	}
	const current = store.getMessage(messageId);
	if (!current) throw new Error('Quick Ask message was not persisted');
	const events = store
		.listEvents(null, sessionId)
		.filter((event) => event.payload.messageId === messageId);
	if (current.status === 'completed') {
		const answer = events
			.filter((event) => event.type === 'agent.chunk')
			.map((event) => String(event.payload.text ?? ''))
			.join('')
			.trim();
		return answer && answer.length <= 30_000
			? { status: 'completed', answer, sessionId, messageId }
			: {
					status: 'failed',
					error: 'Hermes returned an invalid Quick Ask answer',
					sessionId,
					messageId
				};
	}
	const terminal = events.findLast((event) => event.type === `message.${current.status}`);
	return {
		status: current.status === 'unknown' ? 'unknown' : 'failed',
		error: String(terminal?.payload.error ?? `Quick Ask ${current.status}`),
		sessionId,
		messageId
	};
}

export function keepQuickAsk(store: HUEStore, operationId: string): StoredSession {
	return store.promoteQuickAsk(operationId);
}

export async function discardQuickAsk(
	store: HUEStore,
	runtime: Pick<QuickAskRuntime, 'cancelSession'> & { whenIdle(sessionId: string): Promise<void> },
	operationId: string
): Promise<void> {
	const quickAsk = store.getQuickAsk(operationId);
	const message = store.getMessage(operationId);
	if (!quickAsk) throw new Error('Quick Ask not found');
	if (quickAsk.status === 'dismissed') return;
	if (quickAsk.status === 'creating' && !quickAsk.sessionId) {
		store.dismissQuickAsk(operationId);
		return;
	}
	if (!quickAsk.sessionId || quickAsk.status !== 'active') throw new Error('Quick Ask not found');
	if (message?.status === 'queued' || message?.status === 'running') {
		await runtime.cancelSession(quickAsk.sessionId);
		await runtime.whenIdle(quickAsk.sessionId);
	}
	store.dismissQuickAsk(operationId);
}
