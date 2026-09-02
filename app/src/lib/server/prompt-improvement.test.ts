import { describe, expect, it } from 'bun:test';
import { HUEStore } from './store';
import {
	generatePromptImprovement,
	normalizePromptImprovement,
	promptImprovementPrompt
} from './prompt-improvement';

describe('prompt improvement', () => {
	it('removes the one-time refinement Session after preserving its delivery result', async () => {
		const store = new HUEStore(':memory:');
		store.ensureProjectMetadata('hue', 'HUE');
		store.upsertSession('hue', { sessionId: 'source', cwd: '/work/hue' });
		const response = JSON.stringify({
			prompt: 'Design a responsive landing page for a neighborhood bakery.',
			questions: [{ id: 'audience', question: 'Who is the primary audience?' }]
		});
		const result = await generatePromptImprovement(
			{
				projectId: 'hue',
				sourceSessionId: 'source',
				text: 'make bakery site',
				answers: [],
				modelId: 'openai:gpt-5',
				operationId: 'improve-1'
			},
			{
				store,
				runtime: {
					createSession: async (cwd) => ({ sessionId: 'improvement-session', cwd }),
					setModel: async () => {}
				},
				dispatcher: {
					submit: (envelope) => {
						store.acceptMessage(envelope);
						store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
						store.appendEvent('hue', envelope.sessionId, 'agent.chunk', {
							messageId: envelope.id,
							text: response
						});
						store.transitionMessage(envelope.id, 'completed', { messageId: envelope.id });
					},
					whenIdle: async () => {}
				}
			}
		);

		expect(result).toMatchObject({
			status: 'completed',
			prompt: 'Design a responsive landing page for a neighborhood bakery.',
			questions: [{ id: 'audience', question: 'Who is the primary audience?' }],
			sessionId: 'improvement-session',
			messageId: 'improve-1'
		});
		expect(store.getSession('hue', 'improvement-session')).toBeNull();
		expect(store.isSessionDismissed('hue', 'improvement-session')).toBeTrue();
		expect(
			store.listSessionPage('hue', { includeArchived: false, query: '', limit: 100, offset: 0 })
				.sessions.map(({ sessionId }) => sessionId)
		).toEqual(['source']);
		expect(store.getMessage('improve-1')?.text).toBe(
			promptImprovementPrompt('make bakery site', [])
		);
		store.close();
	});

	it('returns a durable pending Session instead of inventing a result', async () => {
		const store = new HUEStore(':memory:');
		store.upsertSession(null, { sessionId: 'source', cwd: '/work/sessions' });
		const result = await generatePromptImprovement(
			{
				projectId: null,
				sourceSessionId: 'source',
				text: 'help me write this',
				answers: [],
				modelId: 'openai:gpt',
				operationId: 'pending-improvement'
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
					},
					whenIdle: () => new Promise(() => {})
				},
				waitTimeoutMs: 1
			}
		);

		expect(result).toEqual({
			status: 'pending',
			sessionId: 'pending-session',
			messageId: 'pending-improvement',
			path: '/?session=pending-session'
		});
		store.close();
	});

	it('strictly validates bounded JSON output', () => {
		expect(
			normalizePromptImprovement(
				JSON.stringify({ prompt: 'Clear result', questions: [{ id: 'scope', question: 'Which scope?' }] })
			)
		).toEqual({
			prompt: 'Clear result',
			questions: [{ id: 'scope', question: 'Which scope?' }]
		});
		expect(() => normalizePromptImprovement('```json\n{}\n```')).toThrow('invalid prompt improvement');
		expect(() => normalizePromptImprovement(JSON.stringify({ prompt: '', questions: [] }))).toThrow(
			'invalid prompt improvement'
		);
		expect(() =>
			normalizePromptImprovement(
				JSON.stringify({
					prompt: 'Result',
					questions: Array.from({ length: 4 }, (_, index) => ({
						id: `q${index}`,
						question: 'Question?'
					}))
				})
			)
		).toThrow('invalid prompt improvement');
		expect(() =>
			normalizePromptImprovement(
				JSON.stringify({
					prompt: 'Result',
					questions: [
						{ id: 'scope', question: 'Which scope?' },
						{ id: 'scope', question: 'Which audience?' }
					]
				})
			)
		).toThrow('invalid prompt improvement');
	});

	it('coalesces concurrent retries before creating a Session', async () => {
		const store = new HUEStore(':memory:');
		store.upsertSession(null, { sessionId: 'source', cwd: '/work/sessions' });
		let sessions = 0;
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const dependencies = {
			store,
			runtime: {
				createSession: async (cwd: string) => {
					sessions += 1;
					await blocked;
					return { sessionId: 'improvement-session', cwd };
				},
				setModel: async () => {}
			},
			dispatcher: {
				submit: (envelope: { id: string; projectId: null; sessionId: string; text: string }) => {
					store.acceptMessage(envelope);
					store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
					store.appendEvent(null, envelope.sessionId, 'agent.chunk', {
						messageId: envelope.id,
						text: JSON.stringify({ prompt: 'Clear prompt', questions: [] })
					});
					store.transitionMessage(envelope.id, 'completed', { messageId: envelope.id });
				},
				whenIdle: async () => {}
			}
		};
		const input = {
			projectId: null,
			sourceSessionId: 'source',
			text: 'make this clear',
			answers: [],
			modelId: 'openai:gpt',
			operationId: 'concurrent-improvement'
		};
		const first = generatePromptImprovement(input, dependencies);
		const retry = generatePromptImprovement(input, dependencies);
		release();

		expect(await retry).toEqual(await first);
		expect(sessions).toBe(1);
		store.close();
	});
});
