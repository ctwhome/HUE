import { describe, expect, it } from 'bun:test';
import type { PromptRuntime } from './message-dispatcher';
import { SessionRuntimeRouter } from './session-runtime-router';
import { HUEStore } from './store';

class RecordingRuntime implements PromptRuntime {
	loaded = new Set<string>();
	resumes: Array<{ cwd: string; sessionId: string }> = [];
	prompts: string[] = [];

	hasSessionState(sessionId: string) {
		return this.loaded.has(sessionId);
	}

	async resumeSession(cwd: string, sessionId: string) {
		this.resumes.push({ cwd, sessionId });
		this.loaded.add(sessionId);
	}

	async prompt(input: Parameters<PromptRuntime['prompt']>[0]) {
		this.prompts.push(input.sessionId);
	}

	async createSession(cwd: string) {
		return { sessionId: 'native-session', cwd, title: 'New Session' };
	}

	async listSessions() {
		return [];
	}

	async forkSession(cwd: string) {
		return this.createSession(cwd);
	}

	async loadTranscript() {
		return [];
	}

	async start() {}
	getAvailableCommands() {
		return [];
	}
	getSessionState() {
		return { profile: 'default', capabilities: this.getCapabilities() };
	}
	getCapabilities() {
		return {
			loadSession: true,
			promptImage: true,
			sessionList: true,
			sessionFork: true,
			sessionResume: true,
			commands: []
		};
	}
	async setModel() {
		return this.getSessionState();
	}
	async setMode() {
		return this.getSessionState();
	}
	async setConfigOption() {
		return this.getSessionState();
	}
	async cancelSession() {}
}

describe('SessionRuntimeRouter', () => {
	it('routes a HUE Session to its persisted harness-native Session id', async () => {
		const store = new HUEStore(':memory:');
		store.upsertSession(null, {
			sessionId: 'opencode:native-session',
			externalSessionId: 'native-session',
			harness: 'opencode',
			cwd: '/work/hue'
		});
		const hermes = new RecordingRuntime();
		const opencode = new RecordingRuntime();
		const router = new SessionRuntimeRouter(store, { hermes, opencode });

		await router.resumeSession('/ignored', 'opencode:native-session');
		await router.prompt({
			sessionId: 'opencode:native-session',
			text: 'Continue',
			images: [],
			workMode: 'autonomous',
			onChunk: () => undefined
		});

		expect(opencode.resumes).toEqual([{ cwd: '/work/hue', sessionId: 'native-session' }]);
		expect(opencode.prompts).toEqual(['native-session']);
		expect(hermes.resumes).toEqual([]);
		expect(hermes.prompts).toEqual([]);
		store.close();
	});

	it('namespaces newly created OpenCode Sessions while preserving Hermes ids', async () => {
		const store = new HUEStore(':memory:');
		const router = new SessionRuntimeRouter(store, {
			hermes: new RecordingRuntime(),
			opencode: new RecordingRuntime()
		});

		expect(await router.createSession('/work/hue', 'opencode')).toMatchObject({
			sessionId: 'opencode:native-session',
			externalSessionId: 'native-session',
			harness: 'opencode'
		});
		expect(await router.createSession('/work/hue', 'hermes')).toMatchObject({
			sessionId: 'native-session',
			externalSessionId: 'native-session',
			harness: 'hermes'
		});
		store.close();
	});
});
