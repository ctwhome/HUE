import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesACP, isolatedHermesEnvironment, normalizeDelegateTaskUpdate } from './hermes-acp';

const realHermesTest = process.env.HUE_REAL_HERMES === '1' ? it : it.skip;

it('builds an isolated real-smoke environment without provider or private-state variables', () => {
	expect(
		isolatedHermesEnvironment(
			{
				PATH: '/usr/bin:/bin',
				TMPDIR: '/tmp',
				OPENAI_API_KEY: 'must-not-leak',
				ANTHROPIC_API_KEY: 'must-not-leak',
				CODEX_HOME: '/private/codex',
				HERMES_HOME: '/private/hermes'
			},
			'/tmp/hue-hermes-isolated'
		)
	).toEqual({
		PATH: '/usr/bin:/bin',
		TMPDIR: '/tmp',
		HOME: '/tmp/hue-hermes-isolated',
		HERMES_HOME: '/tmp/hue-hermes-isolated'
	});
});

describe('HermesACP real integration', () => {
	realHermesTest(
		'negotiates the pinned ACP contract from an isolated Hermes home',
		async () => {
			const hermesHome = mkdtempSync(join(tmpdir(), 'hue-real-hermes-'));
			const cwd = join(hermesHome, 'workspace');
			mkdirSync(cwd);
			await Bun.write(join(cwd, '.keep'), 'isolated compatibility workspace');
			await Bun.write(
				join(hermesHome, 'config.yaml'),
				'model:\n  default: hue-smoke\n  provider: custom\n  base_url: http://127.0.0.1:1/v1\n'
			);
			const options = {
				command: 'hermes',
				profile: 'default',
				env: {
					...isolatedHermesEnvironment(process.env, hermesHome),
					OPENAI_API_KEY: 'hue-smoke-no-secret'
				}
			};
			let runtime = new HermesACP(options);

			try {
				await runtime.start();
				expect(runtime.getRuntimeInfo()).toMatchObject({
					protocolVersion: 1,
					agent: { name: expect.any(String), version: expect.any(String) }
				});
				const session = await runtime.createSession(cwd);
				const state = runtime.getSessionState(session.sessionId);
				expect(state.models?.currentModelId).toBeTruthy();
				expect(state.modes?.currentModeId).toBe('default');
				expect(state.usage?.size).toBeGreaterThan(0);
				const chunks: string[] = [];
				await runtime.prompt({
					sessionId: session.sessionId,
					text: '/version',
					images: [],
					onChunk: (text) => chunks.push(text)
				});
				const persistenceMarker = 'HUE ACP isolated persistence marker';
				await runtime.prompt({
					sessionId: session.sessionId,
					text: persistenceMarker,
					images: [],
					onChunk: () => undefined
				});

				const listed = await runtime.listSessions(cwd);
				expect(listed.some((candidate) => candidate.sessionId === session.sessionId)).toBe(true);
				expect(listed.every((candidate) => candidate.cwd === cwd)).toBe(true);
				expect(chunks.join('').length).toBeGreaterThan(0);
				await runtime.close();

				runtime = new HermesACP(options);
				await runtime.start();
				const restarted = await runtime.listSessions(cwd);
				expect(restarted.some((candidate) => candidate.sessionId === session.sessionId)).toBe(true);
				const replay: string[] = [];
				await runtime.resumeSession(cwd, session.sessionId, (text) => replay.push(text));
				expect(runtime.getSessionState(session.sessionId).profile).toBe('default');
				// ACP excludes adapter-local slash output and failed endpoint output from replay.
				expect(replay).toEqual([]);
				expect(replay.join('')).not.toContain(chunks.join(''));
			} finally {
				try {
					await runtime.close();
				} finally {
					rmSync(hermesHome, { recursive: true, force: true });
				}
			}
		},
		30_000
	);
});

describe('HermesACP update subscriptions', () => {
	it('reports idle and ready ACP health without exposing process state', () => {
		const runtime = new HermesACP();
		const internals = runtime as unknown as { captureInitialization: (response: unknown) => void };

		expect(runtime.healthStatus()).toBe('idle');
		internals.captureInitialization({ protocolVersion: 1 });
		expect(runtime.healthStatus()).toBe('ready');
	});

	it('reports ACP unavailable after startup fails', async () => {
		const runtime = new HermesACP({ command: '/missing/hue-hermes' });

		await expect(runtime.start()).rejects.toThrow();
		expect(runtime.healthStatus()).toBe('unavailable');
		await runtime.close();
	});

	it('forks a session through the ACP session/fork method', async () => {
		const runtime = new HermesACP();
		const requests: Array<{ method: string; params: unknown }> = [];
		const internals = runtime as unknown as {
			context: () => Promise<object>;
			requestRaw: (
				context: object,
				method: string,
				params: unknown
			) => Promise<{ sessionId: string }>;
		};
		internals.context = async () => ({});
		internals.requestRaw = async (_context, method, params) => {
			requests.push({ method, params });
			return { sessionId: 'forked-session' };
		};

		expect(await runtime.forkSession('/work/hue', 'session-1')).toEqual({
			sessionId: 'forked-session',
			cwd: '/work/hue'
		});
		expect(requests).toEqual([
			{
				method: 'session/fork',
				params: { cwd: '/work/hue', sessionId: 'session-1', mcpServers: [] }
			}
		]);
	});

	it('forwards ACP-published thought chunks separately from answer chunks', async () => {
		const runtime = new HermesACP();
		const internals = runtime as unknown as {
			context: () => Promise<{ request: () => Promise<{ stopReason: 'end_turn' }> }>;
			dispatchUpdate: (sessionId: string, update: unknown) => void;
		};
		internals.context = async () => ({
			request: async () => {
				internals.dispatchUpdate('session-1', {
					sessionUpdate: 'agent_thought_chunk',
					content: { type: 'text', text: 'Inspecting the project.' }
				});
				internals.dispatchUpdate('session-1', {
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text: 'Found it.' }
				});
				return { stopReason: 'end_turn' };
			}
		});
		const thoughts: string[] = [];
		const chunks: string[] = [];

		await runtime.prompt({
			sessionId: 'session-1',
			text: 'Find it',
			images: [],
			onThought: (text) => thoughts.push(text),
			onChunk: (text) => chunks.push(text)
		});

		expect(thoughts).toEqual(['Inspecting the project.']);
		expect(chunks).toEqual(['Found it.']);
	});

	it('forwards ACP-published images from the assistant', async () => {
		const runtime = new HermesACP();
		const internals = runtime as unknown as {
			context: () => Promise<{ request: () => Promise<{ stopReason: 'end_turn' }> }>;
			dispatchUpdate: (sessionId: string, update: unknown) => void;
		};
		internals.context = async () => ({
			request: async () => {
				internals.dispatchUpdate('session-1', {
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }
				});
				return { stopReason: 'end_turn' };
			}
		});
		const images: unknown[] = [];

		await runtime.prompt({
			sessionId: 'session-1',
			text: 'Show the screenshot',
			images: [],
			onChunk: () => {},
			onImage: (image) => images.push(image)
		});

		expect(images).toEqual([{ name: 'Hermes image', mimeType: 'image/png', data: 'aGVsbG8=' }]);
	});

	it('exposes only the connected ACP runtime metadata and configured profile', () => {
		const runtime = new HermesACP({ profile: 'work' });
		const internals = runtime as unknown as {
			captureInitialization: (response: unknown) => void;
		};
		internals.captureInitialization({
			protocolVersion: 1,
			agentInfo: { name: 'hermes-agent', version: '0.2.0' },
			agentCapabilities: {
				loadSession: true,
				promptCapabilities: { image: true }
			}
		});

		expect(runtime.getRuntimeInfo()).toEqual({
			profile: 'work',
			protocolVersion: 1,
			agent: { name: 'hermes-agent', version: '0.2.0' },
			capabilities: {
				loadSession: true,
				promptCapabilities: { image: true }
			}
		});
	});

	it('clears cached runtime metadata after the ACP connection is lost', () => {
		const runtime = new HermesACP({ profile: 'work' });
		const internals = runtime as unknown as {
			captureInitialization: (response: unknown) => void;
			dispatchUpdate: (sessionId: string, update: unknown) => void;
			clearRuntimeState: () => void;
		};
		internals.captureInitialization({ protocolVersion: 1 });
		internals.dispatchUpdate('session-1', {
			sessionUpdate: 'available_commands_update',
			availableCommands: [{ name: 'help', description: 'Show help' }]
		});
		internals.clearRuntimeState();

		expect(runtime.getRuntimeInfo()).toEqual({ profile: 'work' });
		expect(runtime.getAvailableCommands('session-1')).toEqual([]);
	});

	it('retains model, mode, profile, and context state for a session', () => {
		const runtime = new HermesACP({ profile: 'work' });
		const internals = runtime as unknown as {
			captureSessionResponse: (sessionId: string, response: unknown) => void;
			dispatchUpdate: (sessionId: string, update: unknown) => void;
		};
		internals.captureSessionResponse('session-1', {
			models: {
				currentModelId: 'openai:gpt-5.6',
				availableModels: [{ modelId: 'openai:gpt-5.6', name: 'GPT 5.6' }]
			},
			modes: {
				currentModeId: 'default',
				availableModes: [{ id: 'default', name: 'Default' }]
			}
		});
		internals.dispatchUpdate('session-1', {
			sessionUpdate: 'usage_update',
			used: 32_000,
			size: 128_000
		});

		expect(runtime.getSessionState('session-1')).toEqual({
			profile: 'work',
			models: {
				currentModelId: 'openai:gpt-5.6',
				availableModels: [{ modelId: 'openai:gpt-5.6', name: 'GPT 5.6' }]
			},
			modes: {
				currentModeId: 'default',
				availableModes: [{ id: 'default', name: 'Default' }]
			},
			usage: { used: 32_000, size: 128_000 }
		});
	});

	it('normalizes delegate_task children, status, and results from Hermes ACP updates', () => {
		const started = normalizeDelegateTaskUpdate({
			sessionUpdate: 'tool_call',
			toolCallId: 'delegate-1',
			title: 'delegate batch (2 tasks)',
			status: 'in_progress',
			content: [
				{
					type: 'content',
					content: {
						type: 'text',
						text: 'Delegating 2 tasks\n\n1. Map moved path references (explore)\n2. Trace Astro move paths (reviewer)'
					}
				}
			]
		});

		expect(started).toEqual({
			id: 'delegate-1',
			title: '2 subagents',
			status: 'in_progress',
			children: [
				{
					index: 0,
					goal: 'Map moved path references',
					role: 'explore',
					status: 'in_progress'
				},
				{
					index: 1,
					goal: 'Trace Astro move paths',
					role: 'reviewer',
					status: 'in_progress'
				}
			]
		});

		expect(
			normalizeDelegateTaskUpdate(
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: 'delegate-1',
					status: 'completed',
					content: [
						{
							type: 'content',
							content: {
								type: 'text',
								text: 'Delegation results: 2 tasks\n\nTask 1: completed (role=explore)\nFound references.\n\nTask 2: failed (role=reviewer)\nError: Timed out'
							}
						}
					]
				},
				started ?? undefined
			)
		).toEqual({
			id: 'delegate-1',
			title: '2 subagents',
			status: 'completed',
			children: [
				{
					index: 0,
					goal: 'Map moved path references',
					role: 'explore',
					status: 'completed',
					result: 'Found references.'
				},
				{
					index: 1,
					goal: 'Trace Astro move paths',
					role: 'reviewer',
					status: 'failed',
					result: 'Timed out'
				}
			]
		});
	});

	it('normalizes a single unnumbered delegate and a delegation-level failure', () => {
		const started = normalizeDelegateTaskUpdate({
			sessionUpdate: 'tool_call',
			toolCallId: 'delegate-2',
			title: 'delegate: Inspect the route',
			status: 'in_progress',
			content: [
				{
					type: 'content',
					content: { type: 'text', text: 'Delegating task:\nInspect the route' }
				}
			]
		});

		expect(started?.children).toEqual([
			{ index: 0, goal: 'Inspect the route', status: 'in_progress' }
		]);
		expect(
			normalizeDelegateTaskUpdate(
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: 'delegate-2',
					status: 'failed',
					content: [
						{
							type: 'content',
							content: { type: 'text', text: 'Delegation failed: model unavailable' }
						}
					]
				},
				started ?? undefined
			)?.children
		).toEqual([
			{ index: 0, goal: 'Inspect the route', status: 'failed', result: 'model unavailable' }
		]);
	});

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
