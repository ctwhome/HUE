import type { SessionHarness } from '$lib/session-harness';
import type { InteractionRequest, PromptRuntime } from './message-dispatcher';
import type { HermesCapabilities, HermesSessionState, HermesTranscriptMessage } from './hermes-acp';
import type { HUEStore, StoredSession } from './store';

type RuntimeSession = {
	sessionId: string;
	cwd: string;
	title?: string | null;
	updatedAt?: string | null;
};

export type SessionRuntimeAdapter = PromptRuntime & {
	createSession(cwd: string): Promise<RuntimeSession>;
	listSessions(cwd: string): Promise<RuntimeSession[]>;
	forkSession(cwd: string, sessionId: string): Promise<RuntimeSession>;
	loadTranscript(cwd: string, sessionId: string): Promise<HermesTranscriptMessage[]>;
	start(): Promise<void>;
	getAvailableCommands(sessionId: string): Array<{
		name: string;
		description: string;
		input?: { hint: string } | null;
	}>;
	getSessionState(sessionId: string): HermesSessionState;
	getCapabilities(sessionId: string): HermesCapabilities;
	setModel(sessionId: string, modelId: string): Promise<HermesSessionState>;
	setMode(sessionId: string, modeId: string): Promise<HermesSessionState>;
	setConfigOption(
		sessionId: string,
		configId: string,
		value: string | boolean
	): Promise<HermesSessionState>;
	cancelSession(sessionId: string): Promise<void>;
};

export type SessionRuntimes = Record<SessionHarness, SessionRuntimeAdapter>;

export class SessionRuntimeRouter implements PromptRuntime {
	constructor(
		private readonly store: HUEStore,
		private readonly runtimes: SessionRuntimes,
		private readonly transcriptLoaders: Partial<
			Record<SessionHarness, (session: StoredSession) => Promise<HermesTranscriptMessage[]>>
		> = {}
	) {}

	private resolve(sessionId: string): { session: StoredSession; runtime: SessionRuntimeAdapter } {
		const session = this.store.getSessionById(sessionId);
		if (!session) throw new Error('Session not found');
		return { session, runtime: this.runtimes[session.harness] };
	}

	async createSession(cwd: string, harness: SessionHarness = 'hermes') {
		const session = await this.runtimes[harness].createSession(cwd);
		return {
			...session,
			sessionId: harness === 'hermes' ? session.sessionId : `${harness}:${session.sessionId}`,
			externalSessionId: session.sessionId,
			harness
		};
	}

	async listSessions(cwd: string, harness: SessionHarness = 'hermes') {
		return (await this.runtimes[harness].listSessions(cwd)).map((session) => ({
			...session,
			sessionId: harness === 'hermes' ? session.sessionId : `${harness}:${session.sessionId}`,
			externalSessionId: session.sessionId,
			harness
		}));
	}

	async loadTranscript(sessionId: string): Promise<HermesTranscriptMessage[]> {
		const { session, runtime } = this.resolve(sessionId);
		const loader = this.transcriptLoaders[session.harness];
		if (loader) return loader(session);
		return runtime.loadTranscript(session.cwd, session.externalSessionId);
	}

	async forkSession(_cwd: string, sessionId: string) {
		const { session, runtime } = this.resolve(sessionId);
		const fork = await runtime.forkSession(session.cwd, session.externalSessionId);
		return {
			...fork,
			sessionId:
				session.harness === 'hermes' ? fork.sessionId : `${session.harness}:${fork.sessionId}`,
			externalSessionId: fork.sessionId,
			harness: session.harness
		};
	}

	getAvailableCommands(sessionId: string) {
		const { session, runtime } = this.resolve(sessionId);
		return runtime.getAvailableCommands(session.externalSessionId);
	}

	getSessionState(sessionId: string) {
		const { session, runtime } = this.resolve(sessionId);
		return { ...runtime.getSessionState(session.externalSessionId), harness: session.harness };
	}

	getCapabilities(sessionId: string) {
		const { session, runtime } = this.resolve(sessionId);
		return runtime.getCapabilities(session.externalSessionId);
	}

	async start(sessionId: string): Promise<void> {
		await this.resolve(sessionId).runtime.start();
	}

	async setModel(sessionId: string, modelId: string) {
		const { session, runtime } = this.resolve(sessionId);
		return {
			...(await runtime.setModel(session.externalSessionId, modelId)),
			harness: session.harness
		};
	}

	async setMode(sessionId: string, modeId: string) {
		const { session, runtime } = this.resolve(sessionId);
		return {
			...(await runtime.setMode(session.externalSessionId, modeId)),
			harness: session.harness
		};
	}

	async setConfigOption(sessionId: string, configId: string, value: string | boolean) {
		const { session, runtime } = this.resolve(sessionId);
		return {
			...(await runtime.setConfigOption(session.externalSessionId, configId, value)),
			harness: session.harness
		};
	}

	async cancelSession(sessionId: string) {
		const { session, runtime } = this.resolve(sessionId);
		await runtime.cancelSession(session.externalSessionId);
	}

	hasSessionState(sessionId: string): boolean {
		const { session, runtime } = this.resolve(sessionId);
		return runtime.hasSessionState(session.externalSessionId);
	}

	async resumeSession(_cwd: string, sessionId: string): Promise<void> {
		const { session, runtime } = this.resolve(sessionId);
		await runtime.resumeSession(session.cwd, session.externalSessionId);
	}

	async prompt(input: Parameters<PromptRuntime['prompt']>[0]): Promise<void> {
		const { session, runtime } = this.resolve(input.sessionId);
		await runtime.prompt({
			...input,
			sessionId: session.externalSessionId,
			...(input.onInteraction
				? {
						onInteraction: (request: InteractionRequest) =>
							input.onInteraction!({ ...request, sessionId: session.sessionId })
					}
				: {})
		});
	}
}
