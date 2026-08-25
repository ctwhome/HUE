import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	HermesACP,
	buildWorkModePromptEnvelope,
	isolatedHermesEnvironment,
	normalizeDelegateTaskUpdate,
	normalizeToolCallUpdate,
	redactToolPayload,
	stripExactWorkModePreamble
} from './hermes-acp';

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
		'inlines an isolated staged file through installed Hermes prompt processing',
		async () => {
			const hermesHome = mkdtempSync(join(tmpdir(), 'hue-real-hermes-resource-'));
			const file = join(hermesHome, 'proof.txt');
			const marker = `HUE_RESOURCE_${crypto.randomUUID()}`;
			await Bun.write(file, marker);
			const install = join(homedir(), '.hermes', 'hermes-agent');
			const child = Bun.spawn(
				[
					join(install, 'venv', 'bin', 'python'),
					'-c',
					`import json,sys
from acp.schema import ResourceContentBlock
from acp_adapter.server import _content_blocks_to_openai_user_content
block=ResourceContentBlock.model_validate({'type':'resource_link','uri':sys.argv[1],'name':'proof.txt','mimeType':'text/plain','size':int(sys.argv[2])})
print(json.dumps(_content_blocks_to_openai_user_content([block])))`,
					pathToFileURL(file).href,
					String(marker.length)
				],
				{
					cwd: install,
					env: isolatedHermesEnvironment(process.env, hermesHome),
					stdout: 'pipe',
					stderr: 'pipe'
				}
			);
			try {
				const [status, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text()
				]);
				expect(status, stderr).toBe(0);
				expect(stdout).toContain(marker);
			} finally {
				rmSync(hermesHome, { recursive: true, force: true });
			}
		},
		15_000
	);

	realHermesTest(
		'reports installed clarify capability without provider credentials or private Hermes state',
		async () => {
			const hermesHome = mkdtempSync(join(tmpdir(), 'hue-real-hermes-capability-'));
			const runtime = new HermesACP({
				command: 'hermes',
				env: isolatedHermesEnvironment(process.env, hermesHome)
			});
			try {
				await runtime.start();
				expect(runtime.getRuntimeInfo()).toMatchObject({
					agent: { name: 'hermes-agent', version: '0.20.5' },
					clarify: {
						status: 'unsupported',
						reason: 'Hermes ACP has not sent elicitation/create'
					}
				});
			} finally {
				await runtime.close();
				rmSync(hermesHome, { recursive: true, force: true });
			}
		},
		15_000
	);

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
					workMode: 'autonomous',
					onChunk: (text) => chunks.push(text)
				});
				const persistenceMarker = 'HUE ACP isolated persistence marker';
				await runtime.prompt({
					sessionId: session.sessionId,
					text: persistenceMarker,
					images: [],
					workMode: 'autonomous',
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
	it('builds exact work-mode _meta envelope and strips only exact replay preamble', () => {
		const live = buildWorkModePromptEnvelope('live', 'Ship fix');
		expect(live.meta).toEqual({
			hue: { workMode: 'live', version: 1, authorityUnchanged: true }
		});
		expect(live.text).toContain('cadence only');
		expect(live.text).toContain('does not authorize external effects');
		expect(live.text).toContain('Ship fix');
		expect(stripExactWorkModePreamble(live.text)).toBe('Ship fix');

		const autonomous = buildWorkModePromptEnvelope('autonomous', 'Wrap this up');
		expect(autonomous.meta).toEqual({
			hue: { workMode: 'autonomous', version: 1, authorityUnchanged: true }
		});
		expect(autonomous.text).toContain('Assume user is not watching.');
		expect(stripExactWorkModePreamble('Original user message follows exactly.\nWrap this up')).toBe(
			'Original user message follows exactly.\nWrap this up'
		);
		expect(buildWorkModePromptEnvelope('autonomous', '/version').text).toBe('/version');
	});

	it('redacts secrets recursively without changing safe tool data', () => {
		expect(
			redactToolPayload({
				command: 'curl -H "Authorization: Bearer abc123" https://example.test',
				shell: 'deploy --api-key supersecret TOKEN=hidden https://user:pass@example.test',
				apiKey: 'secret-key',
				nested: { password: 'hunter2', path: 'src/routes/+page.svelte' }
			})
		).toEqual({
			command: 'curl -H "Authorization: [REDACTED]" https://example.test',
			shell: 'deploy --api-key [REDACTED] TOKEN=[REDACTED] https://[REDACTED]@example.test',
			apiKey: '[REDACTED]',
			nested: { password: '[REDACTED]', path: 'src/routes/+page.svelte' }
		});
	});

	it('merges ACP tool patches and records duration from first sight', () => {
		const started = normalizeToolCallUpdate(
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'tool-1',
				name: 'terminal',
				title: 'Run tests',
				kind: 'execute',
				status: 'in_progress',
				rawInput: { command: 'bun test', token: 'must-hide' }
			},
			undefined,
			1_000
		);
		const completed = normalizeToolCallUpdate(
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'tool-1',
				status: 'failed',
				rawOutput: { error: 'Timed out', authorization: 'Bearer must-hide' }
			},
			started,
			1_425
		);

		expect(completed).toEqual({
			id: 'tool-1',
			name: 'terminal',
			title: 'Run tests',
			kind: 'execute',
			status: 'failed',
			args: { command: 'bun test', token: '[REDACTED]' },
			result: { error: 'Timed out', authorization: '[REDACTED]' },
			error: 'Timed out',
			startedAt: 1_000,
			completedAt: 1_425,
			durationMs: 425
		});
		expect(
			normalizeToolCallUpdate(
				{ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'failed' },
				completed,
				2_000
			)
		).toMatchObject({ completedAt: 1_425, durationMs: 425 });
	});

	it('uses ACP display content when Hermes intentionally omits polished raw payloads', () => {
		const started = normalizeToolCallUpdate(
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'tool-content',
				name: 'read_file',
				title: 'read: config.json',
				status: 'in_progress',
				content: [{ type: 'content', content: { type: 'text', text: '{"path":"config.json"}' } }]
			},
			undefined,
			10
		);
		const completed = normalizeToolCallUpdate(
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'tool-content',
				status: 'completed',
				content: [
					{ type: 'content', content: { type: 'text', text: 'Read config.json successfully.' } }
				]
			},
			started,
			20
		);

		expect(completed.args).toBe('{"path":"config.json"}');
		expect(completed.result).toBe('Read config.json successfully.');
	});

	it('sends session cancellation as an ACP notification', async () => {
		const runtime = new HermesACP();
		let requestCalled = false;
		let notifiedMethod = '';
		let cancelledSessionId = '';
		const internals = runtime as unknown as {
			context: () => Promise<{
				request: () => Promise<void>;
				notify: (method: string, params: { sessionId: string }) => Promise<void>;
			}>;
		};
		internals.context = async () => ({
			request: async () => {
				requestCalled = true;
			},
			notify: async (method, { sessionId }) => {
				notifiedMethod = method;
				cancelledSessionId = sessionId;
			}
		});

		await runtime.cancelSession('session-1');

		expect(requestCalled).toBe(false);
		expect(notifiedMethod).toBe('session/cancel');
		expect(cancelledSessionId).toBe('session-1');
	});

	it('forwards chronological tool and active plan updates from ACP', async () => {
		const runtime = new HermesACP();
		const internals = runtime as unknown as {
			context: () => Promise<{ request: () => Promise<{ stopReason: 'end_turn' }> }>;
			dispatchUpdate: (sessionId: string, update: unknown) => void;
		};
		internals.context = async () => ({
			request: async () => {
				internals.dispatchUpdate('session-1', {
					sessionUpdate: 'tool_call',
					toolCallId: 'tool-1',
					name: 'read_file',
					title: 'Read file',
					status: 'in_progress',
					rawInput: { path: 'README.md' }
				});
				internals.dispatchUpdate('session-1', {
					sessionUpdate: 'plan',
					entries: [
						{ content: 'Inspect files', priority: 'high', status: 'in_progress' },
						{ content: 'Report result', priority: 'medium', status: 'pending' }
					]
				});
				return { stopReason: 'end_turn' };
			}
		});
		const tools: unknown[] = [];
		const plans: unknown[] = [];

		await runtime.prompt({
			sessionId: 'session-1',
			text: 'Inspect',
			images: [],
			workMode: 'autonomous',
			onChunk: () => {},
			onTool: (tool) => tools.push(tool),
			onPlan: (plan) => plans.push(plan)
		});

		expect(tools).toMatchObject([
			{ id: 'tool-1', name: 'read_file', status: 'in_progress', args: { path: 'README.md' } }
		]);
		expect(plans).toEqual([
			[
				{ content: 'Inspect files', priority: 'high', status: 'in_progress' },
				{ content: 'Report result', priority: 'medium', status: 'pending' }
			]
		]);
	});

	it('never grants permission without an active explicit interaction handler', async () => {
		const runtime = new HermesACP();
		const internals = runtime as unknown as {
			handlePermission: (request: unknown) => Promise<unknown>;
		};

		expect(
			await internals.handlePermission({
				sessionId: 'session-1',
				toolCall: {
					toolCallId: 'perm-check-1',
					title: 'Run command',
					kind: 'execute',
					status: 'pending',
					rawInput: { command: 'rm file.txt' }
				},
				options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }]
			})
		).toEqual({ outcome: { outcome: 'cancelled' } });
	});

	it('bridges permission and form elicitation only while their Session turn is active', async () => {
		const runtime = new HermesACP();
		const internals = runtime as unknown as {
			context: () => Promise<{ request: () => Promise<{ stopReason: 'end_turn' }> }>;
			handlePermission: (request: unknown) => Promise<unknown>;
			handleElicitation: (request: unknown) => Promise<unknown>;
		};
		const interactions: unknown[] = [];
		internals.context = async () => ({
			request: async () => {
				expect(
					await internals.handlePermission({
						sessionId: 'session-1',
						toolCall: { toolCallId: 'perm-1', title: 'Execute', rawInput: { command: 'pwd' } },
						options: [
							{ optionId: 'once', name: 'Allow once', kind: 'allow_once' },
							{ optionId: 'session', name: 'Allow for session', kind: 'allow_always' },
							{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }
						]
					})
				).toEqual({ outcome: { outcome: 'selected', optionId: 'session' } });
				expect(
					await internals.handleElicitation({
						mode: 'form',
						sessionId: 'session-1',
						message: 'Choose deployment',
						requestedSchema: {
							type: 'object',
							properties: {
								target: { type: 'string', enum: ['staging', 'production'] },
								checks: { type: 'array', items: { type: 'string', enum: ['unit', 'e2e'] } },
								note: { type: 'string' }
							}
						}
					})
				).toEqual({
					action: 'accept',
					content: { target: 'staging', checks: ['unit'], note: 'Go' }
				});
				return { stopReason: 'end_turn' };
			}
		});

		await runtime.prompt({
			sessionId: 'session-1',
			text: 'Deploy',
			images: [],
			workMode: 'autonomous',
			onChunk: () => {},
			onInteraction: async (request) => {
				interactions.push(request);
				return request.kind === 'permission'
					? { outcome: { outcome: 'selected', optionId: 'session' } }
					: { action: 'accept', content: { target: 'staging', checks: ['unit'], note: 'Go' } };
			}
		});

		expect(interactions).toEqual([
			expect.objectContaining({ kind: 'permission', id: 'perm-1', sessionId: 'session-1' }),
			expect.objectContaining({
				kind: 'clarify',
				sessionId: 'session-1',
				message: 'Choose deployment',
				fields: [
					expect.objectContaining({ name: 'target', control: 'single' }),
					expect.objectContaining({ name: 'checks', control: 'multi' }),
					expect.objectContaining({ name: 'note', control: 'text' })
				]
			})
		]);
		expect(runtime.getRuntimeInfo().clarify).toEqual({ status: 'available' });
	});
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
			workMode: 'autonomous',
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
			workMode: 'autonomous',
			onChunk: () => {},
			onImage: (image) => images.push(image)
		});

		expect(images).toEqual([{ name: 'Hermes image', mimeType: 'image/png', data: 'aGVsbG8=' }]);
	});

	it('stages non-image inputs as private readable files and removes them after prompt', async () => {
		const runtime = new HermesACP();
		let prompt: unknown;
		let stagedPath = '';
		const internals = runtime as unknown as {
			context: () => Promise<{
				request: (
					_method: unknown,
					params: { prompt: unknown }
				) => Promise<{ stopReason: 'end_turn' }>;
			}>;
		};
		internals.context = async () => ({
			request: async (_method, params) => {
				prompt = params.prompt;
				stagedPath = fileURLToPath(((prompt as unknown[])[1] as { uri: string }).uri);
				expect(readFileSync(stagedPath, 'utf8')).toBe('hello');
				expect(statSync(stagedPath).mode & 0o777).toBe(0o600);
				expect(statSync(join(stagedPath, '..')).mode & 0o777).toBe(0o700);
				return { stopReason: 'end_turn' };
			}
		});

		await runtime.prompt({
			sessionId: 'session-1',
			text: 'Review file',
			images: [],
			workMode: 'autonomous',
			attachments: [{ name: 'notes.md', mimeType: 'text/markdown', size: 5, data: 'aGVsbG8=' }],
			onChunk: () => {}
		});

		expect(prompt).toEqual([
			{
				type: 'text',
				text: expect.stringContaining('Original user message follows exactly.\n---\nReview file')
			},
			{
				type: 'resource_link',
				uri: expect.stringMatching(/^file:\/\//),
				name: 'notes.md',
				mimeType: 'text/markdown',
				size: 5
			}
		]);
		expect(existsSync(stagedPath)).toBe(false);
	});

	it('removes staged attachment files when Hermes prompt errors', async () => {
		const runtime = new HermesACP();
		let stagedPath = '';
		const internals = runtime as unknown as {
			context: () => Promise<{
				request: (_method: unknown, params: { prompt: unknown[] }) => Promise<never>;
			}>;
		};
		internals.context = async () => ({
			request: async (_method, params) => {
				stagedPath = fileURLToPath((params.prompt[1] as { uri: string }).uri);
				throw new Error(`transport failed while reading ${stagedPath}`);
			}
		});
		let failure = '';
		try {
			await runtime.prompt({
				sessionId: 'session-1',
				text: '',
				images: [],
				workMode: 'autonomous',
				attachments: [{ name: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'aGVsbG8=' }],
				onChunk: () => {}
			});
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		expect(failure).toContain('ACP disconnected before acknowledgement');
		expect(failure).not.toContain(stagedPath);
		expect(existsSync(stagedPath)).toBe(false);
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
			},
			clarify: {
				status: 'unsupported',
				reason: 'Hermes ACP has not sent elicitation/create'
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

	it('retains model, mode, reasoning, profile, and context state for a session', () => {
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
			},
			configOptions: [
				{
					type: 'select',
					id: 'reasoning',
					name: 'Reasoning',
					category: 'thought_level',
					currentValue: 'balanced',
					options: [{ value: 'balanced', name: 'Balanced' }, { value: 'high', name: 'High' }]
				}
			]
		});
		internals.dispatchUpdate('session-1', {
			sessionUpdate: 'config_option_update',
			configOptions: [
				{
					type: 'select',
					id: 'reasoning',
					name: 'Reasoning',
					category: 'thought_level',
					currentValue: 'high',
					options: [{ value: 'balanced', name: 'Balanced' }, { value: 'high', name: 'High' }]
				}
			]
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
			configOptions: [
				{
					type: 'select',
					id: 'reasoning',
					name: 'Reasoning',
					category: 'thought_level',
					currentValue: 'high',
					options: [{ value: 'balanced', name: 'Balanced' }, { value: 'high', name: 'High' }]
				}
			],
			usage: { used: 32_000, size: 128_000 }
		});
	});

	it('forwards session info updates independently of prompt subscribers', () => {
		const updates: Array<{ sessionId: string; title: string | null | undefined }> = [];
		const runtime = new HermesACP({
			onSessionInfo: (sessionId, update) => updates.push({ sessionId, title: update.title })
		});
		const internals = runtime as unknown as {
			dispatchUpdate: (sessionId: string, update: unknown) => void;
		};

		internals.dispatchUpdate('session-1', {
			sessionUpdate: 'session_info_update',
			title: 'Debug message delivery'
		});

		expect(updates).toEqual([{ sessionId: 'session-1', title: 'Debug message delivery' }]);
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
