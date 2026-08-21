import { describe, expect, it } from 'bun:test';
import { HermesACP } from './hermes-acp';

const realHermesTest = process.env.HUE_REAL_HERMES === '1' ? it : it.skip;

describe('HermesACP real integration', () => {
	realHermesTest(
		'creates a session and streams an ACP-local prompt without an LLM call',
		async () => {
			const runtime = new HermesACP({ command: 'hermes', profile: 'default' });
			const cwd = process.cwd();

			try {
				await runtime.start();
				const session = await runtime.createSession(cwd);
				const chunks: string[] = [];
				await runtime.prompt({
					sessionId: session.sessionId,
					text: '/version',
					images: [],
					onChunk: (text) => chunks.push(text)
				});

				const listed = await runtime.listSessions(cwd);
				expect(listed.every((candidate) => candidate.cwd === cwd)).toBe(true);
				expect(chunks.join('').length).toBeGreaterThan(0);

				const replay: string[] = [];
				await runtime.resumeSession(cwd, session.sessionId, (text) => replay.push(text));
				// ACP intentionally excludes adapter-local slash output from persisted history.
				expect(replay).toEqual([]);
			} finally {
				await runtime.close();
			}
		},
		30_000
	);
});

describe('HermesACP update subscriptions', () => {
	it('retains Hermes-advertised slash commands for the session', () => {
		const runtime = new HermesACP();
		const subscriptions = runtime as unknown as {
			dispatchUpdate: (sessionId: string, update: unknown) => void;
		};
		subscriptions.dispatchUpdate('session-1', {
			sessionUpdate: 'available_commands_update',
			availableCommands: [
				{ name: 'compress', description: 'Compress conversation context', input: null }
			]
		});

		expect(runtime.getAvailableCommands('session-1')).toEqual([
			{ name: 'compress', description: 'Compress conversation context', input: null }
		]);
	});

	it('keeps concurrent handlers until each operation unsubscribes', () => {
		const runtime = new HermesACP();
		const subscriptions = runtime as unknown as {
			subscribe: (sessionId: string, handler: (update: unknown) => void) => () => void;
			dispatchUpdate: (sessionId: string, update: unknown) => void;
		};
		const first: unknown[] = [];
		const second: unknown[] = [];
		const unsubscribeFirst = subscriptions.subscribe('session-1', (update) => first.push(update));
		const unsubscribeSecond = subscriptions.subscribe('session-1', (update) => second.push(update));
		const initial = { sessionUpdate: 'agent_message_chunk' };

		subscriptions.dispatchUpdate('session-1', initial);
		unsubscribeFirst();
		const remaining = { sessionUpdate: 'tool_call' };
		subscriptions.dispatchUpdate('session-1', remaining);
		unsubscribeSecond();

		expect(first).toEqual([initial]);
		expect(second).toEqual([initial, remaining]);
	});
});
