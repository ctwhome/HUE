import { describe, expect, it } from 'bun:test';
import { HUEStore } from './store';
import {
	commitGenerationPrompt,
	generateRepositoryCommitMessage,
	normalizeCommitMessage
} from './commit-generation';

describe('ACP commit generation', () => {
	it('returns durable pending identity when interaction keeps the Session busy', async () => {
		const store = new HUEStore(':memory:');
		store.ensureProjectMetadata('hue', 'HUE');
		const result = await generateRepositoryCommitMessage(
			{
				projectId: 'hue',
				repositoryRoot: '/work/hue',
				diff: 'diff',
				modelId: 'openai:gpt',
				operationId: 'pending-message'
			},
			{
				store,
				runtime: {
					createSession: async (cwd) => ({ sessionId: 'pending-session', cwd }),
					setModel: async () => {}
				},
				dispatcher: {
					submit: (envelope) => {
						store.acceptMessage(envelope);
						store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
						store.appendEvent('hue', envelope.sessionId, 'agent.permission', {
							id: 'permission-1',
							messageId: envelope.id,
							status: 'pending'
						});
					},
					whenIdle: () => new Promise(() => {})
				},
				waitTimeoutMs: 1
			}
		);

		expect(result).toEqual({
			status: 'pending',
			sessionId: 'pending-session',
			messageId: 'pending-message',
			path: '/?project=hue&session=pending-session'
		});
		expect(store.getMessage('pending-message')?.status).toBe('running');
		const retry = await Promise.race([
			generateRepositoryCommitMessage(
				{
					projectId: 'hue',
					repositoryRoot: '/work/hue',
					diff: 'diff',
					modelId: 'openai:gpt',
					operationId: 'pending-message'
				},
				{
					store,
					runtime: {
						createSession: async () => {
							throw new Error('must not create another Session');
						},
						setModel: async () => {}
					},
					dispatcher: { submit: () => {}, whenIdle: () => new Promise(() => {}) },
					waitTimeoutMs: 1
				}
			),
			Bun.sleep(50).then(() => 'timed-out' as const)
		]);
		expect(retry).toEqual(result);
		store.close();
	});

	it('persists a project Session and complete envelope before deriving the result from events', async () => {
		const store = new HUEStore(':memory:');
		store.ensureProjectMetadata('hue', 'HUE');
		const calls: string[] = [];
		const runtime = {
			createSession: async (cwd: string) => ({ sessionId: 'commit-session', cwd }),
			setModel: async (sessionId: string, modelId: string) => {
				calls.push(`${sessionId}:${modelId}`);
			}
		};
		const dispatcher = {
			submit: (envelope: { id: string; projectId: string; sessionId: string; text: string }) => {
				store.acceptMessage(envelope);
				store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
				store.appendEvent('hue', envelope.sessionId, 'agent.chunk', {
					messageId: envelope.id,
					text: 'feat: durable commit drafts'
				});
				store.transitionMessage(envelope.id, 'completed', { messageId: envelope.id });
				return { duplicate: false, status: 'queued' as const };
			},
			whenIdle: async () => {}
		};

		const result = await generateRepositoryCommitMessage(
			{
				projectId: 'hue',
				repositoryRoot: '/work/hue',
				diff: 'diff --git a/a b/a',
				modelId: 'openai:gpt-5',
				operationId: 'commit-message'
			},
			{ store, runtime, dispatcher }
		);

		expect(result).toEqual({
			status: 'completed',
			message: 'feat: durable commit drafts',
			sessionId: 'commit-session',
			messageId: 'commit-message'
		});
		expect(store.getSession('hue', 'commit-session')).toMatchObject({
			cwd: '/work/hue',
			title: 'Commit message draft',
			folder: 'Repository'
		});
		expect(store.getMessage('commit-message')?.text).toBe(
			commitGenerationPrompt('diff --git a/a b/a')
		);
		expect(calls).toEqual(['commit-session:openai:gpt-5']);
		store.close();
	});

	it('returns failed or unknown durable delivery state without inventing output', async () => {
		for (const status of ['failed', 'unknown'] as const) {
			const store = new HUEStore(':memory:');
			store.ensureProjectMetadata('hue', 'HUE');
			const result = await generateRepositoryCommitMessage(
				{
					projectId: 'hue',
					repositoryRoot: '/work/hue',
					diff: 'diff',
					modelId: 'openai:gpt',
					operationId: `message-${status}`
				},
				{
					store,
					runtime: {
						createSession: async (cwd) => ({ sessionId: `session-${status}`, cwd }),
						setModel: async () => {}
					},
					dispatcher: {
						submit: (envelope) => {
							store.acceptMessage(envelope);
							store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
							store.transitionMessage(envelope.id, status, {
								messageId: envelope.id,
								error: `${status} delivery`
							});
							return { duplicate: false, status: 'queued' as const };
						},
						whenIdle: async () => {}
					}
				}
			);
			expect(result).toMatchObject({ status, error: `${status} delivery` });
			expect(result).not.toHaveProperty('message');
			store.close();
		}
	});

	it('normalizes one bounded Conventional Commit subject', () => {
		expect(normalizeCommitMessage('  feat: add generation  ')).toBe('feat: add generation');
		expect(() => normalizeCommitMessage('')).toThrow('empty commit message');
		expect(() => normalizeCommitMessage('```text\nfeat: add generation\n```')).toThrow(
			'invalid commit message'
		);
		expect(() => normalizeCommitMessage('Here is your commit message')).toThrow(
			'invalid commit message'
		);
		expect(() => normalizeCommitMessage('Explanation\nfeat: valid-looking')).toThrow(
			'invalid commit message'
		);
		expect(() => normalizeCommitMessage(`feat: ${'x'.repeat(72)}`)).toThrow(
			'invalid commit message'
		);
	});

	it('reuses the original durable operation across request retries', async () => {
		const store = new HUEStore(':memory:');
		store.ensureProjectMetadata('hue', 'HUE');
		let sessions = 0;
		const runtime = {
			createSession: async (cwd: string) => ({ sessionId: `commit-session-${++sessions}`, cwd }),
			setModel: async () => {}
		};
		const dispatcher = {
			submit: (envelope: { id: string; projectId: string; sessionId: string; text: string }) => {
				store.acceptMessage(envelope);
				store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
				store.appendEvent('hue', envelope.sessionId, 'agent.chunk', {
					messageId: envelope.id,
					text: 'fix: reuse commit draft'
				});
				store.transitionMessage(envelope.id, 'completed', { messageId: envelope.id });
			},
			whenIdle: async () => {}
		};
		const input = {
			projectId: 'hue',
			repositoryRoot: '/work/hue',
			diff: 'diff',
			modelId: 'openai:gpt',
			operationId: 'commit-operation'
		};

		const [first, concurrent] = await Promise.all([
			generateRepositoryCommitMessage(input, { store, runtime, dispatcher }),
			generateRepositoryCommitMessage(input, { store, runtime, dispatcher })
		]);
		const retry = await generateRepositoryCommitMessage(input, { store, runtime, dispatcher });

		expect(concurrent).toEqual(first);
		expect(retry).toEqual(first);
		expect(sessions).toBe(1);
		store.close();
	});

	it('rejects conflicting concurrent reuse of an operation id', async () => {
		const store = new HUEStore(':memory:');
		store.ensureProjectMetadata('hue', 'HUE');
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const runtime = {
			createSession: async (cwd: string) => {
				await blocked;
				return { sessionId: 'commit-session', cwd };
			},
			setModel: async () => {}
		};
		const dispatcher = {
			submit: (envelope: { id: string; projectId: string; sessionId: string; text: string }) => {
				store.acceptMessage(envelope);
				store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
				store.appendEvent('hue', envelope.sessionId, 'agent.chunk', {
					messageId: envelope.id,
					text: 'fix: reserve operations'
				});
				store.transitionMessage(envelope.id, 'completed', { messageId: envelope.id });
			},
			whenIdle: async () => {}
		};
		const input = {
			projectId: 'hue',
			repositoryRoot: '/work/hue',
			diff: 'first diff',
			modelId: 'openai:gpt',
			operationId: 'shared-operation'
		};
		const first = generateRepositoryCommitMessage(input, { store, runtime, dispatcher });
		const conflict = generateRepositoryCommitMessage(
			{ ...input, diff: 'different diff' },
			{ store, runtime, dispatcher }
		);
		release();

		await expect(conflict).rejects.toThrow('already in use');
		await first;
		store.close();
	});

	it('does not create another Session after a reserved operation fails', async () => {
		const store = new HUEStore(':memory:');
		store.ensureProjectMetadata('hue', 'HUE');
		let sessions = 0;
		const dependencies = {
			store,
			runtime: {
				createSession: async () => {
					sessions += 1;
					throw new Error('Hermes unavailable');
				},
				setModel: async () => {}
			},
			dispatcher: { submit: () => {}, whenIdle: async () => {} }
		};
		const input = {
			projectId: 'hue',
			repositoryRoot: '/work/hue',
			diff: 'diff',
			modelId: 'openai:gpt',
			operationId: 'failed-operation'
		};

		const first = await generateRepositoryCommitMessage(input, dependencies);
		const retry = await generateRepositoryCommitMessage(input, dependencies);

		expect(first).toMatchObject({ status: 'failed', error: 'Hermes unavailable' });
		expect(retry).toEqual(first);
		expect(sessions).toBe(1);
		store.close();
	});
});
