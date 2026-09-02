import { describe, expect, it } from 'bun:test';
import { HUEStore } from './store';
import { discardQuickAsk, generateQuickAsk, keepQuickAsk, quickAskPrompt } from './quick-ask';

describe('quick ask', () => {
	it('returns one answer without adding an active Chat', async () => {
		const store = new HUEStore(':memory:');
		const result = await generateQuickAsk(
			{ question: 'Why is the sky blue?', operationId: 'quick-1', sessionRoot: '/work/quick' },
			{
				store,
				runtime: {
					createSession: async (cwd) => ({ sessionId: 'quick-session', cwd }),
					cancelSession: async () => {}
				},
				dispatcher: {
					submit: (envelope) => {
						expect(store.getSession(null, envelope.sessionId)?.archived).toBeTrue();
						store.acceptMessage(envelope);
						store.transitionMessage(envelope.id, 'running', { messageId: envelope.id });
						store.appendEvent(null, envelope.sessionId, 'agent.chunk', {
							messageId: envelope.id,
							text: 'Sunlight scatters in the atmosphere.'
						});
						store.transitionMessage(envelope.id, 'completed', { messageId: envelope.id });
					},
					whenIdle: async () => {}
				}
			}
		);

		expect(result).toEqual({
			status: 'completed',
			answer: 'Sunlight scatters in the atmosphere.',
			sessionId: 'quick-session',
			messageId: 'quick-1'
		});
		expect(store.listSessionPage(null, { includeArchived: false, query: '', limit: 100, offset: 0 }).sessions).toEqual([]);
		expect(store.getMessage('quick-1')?.text).toBe(quickAskPrompt('Why is the sky blue?'));
		store.close();
	});

	it('keeps the existing temporary Session as a Chat', async () => {
		const store = new HUEStore(':memory:');
		store.reserveQuickAsk('quick-keep', 'hash');
		store.attachQuickAsk('quick-keep', 'quick-session');
		store.upsertSession(null, { sessionId: 'quick-session', cwd: '/work/quick', title: 'Quick Ask' });
		store.updateSession(null, 'quick-session', { archived: true });
		store.acceptMessage({
			id: 'quick-keep',
			projectId: null,
			sessionId: 'quick-session',
			text: quickAskPrompt('Keep this'),
			images: [],
			attachments: [],
			reviewContexts: []
		});
		store.transitionMessage('quick-keep', 'running', { messageId: 'quick-keep' });
		store.transitionMessage('quick-keep', 'completed', { messageId: 'quick-keep' });

		expect(keepQuickAsk(store, 'quick-keep')).toMatchObject({
			sessionId: 'quick-session',
			title: 'Quick Ask',
			archived: false
		});
		expect(keepQuickAsk(store, 'quick-keep').sessionId).toBe('quick-session');
		store.close();
	});

	it('removes the temporary Session and its HUE transcript', async () => {
		const store = new HUEStore(':memory:');
		store.reserveQuickAsk('quick-discard', 'hash');
		store.attachQuickAsk('quick-discard', 'quick-session');
		store.upsertSession(null, { sessionId: 'quick-session', cwd: '/work/quick', title: 'Quick Ask' });
		store.updateSession(null, 'quick-session', { archived: true });
		store.acceptMessage({
			id: 'quick-discard',
			projectId: null,
			sessionId: 'quick-session',
			text: quickAskPrompt('Discard this'),
			images: [],
			attachments: [],
			reviewContexts: []
		});
		let cancelled = '';

		await discardQuickAsk(
			store,
			{ cancelSession: async (sessionId) => (cancelled = sessionId), whenIdle: async () => {} },
			'quick-discard'
		);

		expect(cancelled).toBe('quick-session');
		expect(store.getSession(null, 'quick-session')).toBeNull();
		expect(store.isSessionDismissed(null, 'quick-session')).toBeTrue();
		expect(store.getMessage('quick-discard')).toBeNull();
		expect(store.listEvents(null, 'quick-session')).toEqual([]);
		expect(store.listNotifications({}).items).toEqual([]);
		await expect(
			discardQuickAsk(
				store,
				{ cancelSession: async () => {}, whenIdle: async () => {} },
				'quick-discard'
			)
		).resolves.toBeUndefined();
		store.close();
	});

	it('dismisses an interrupted reservation without a Session', async () => {
		const store = new HUEStore(':memory:');
		store.reserveQuickAsk('quick-interrupted', 'hash');

		await discardQuickAsk(
			store,
			{ cancelSession: async () => {}, whenIdle: async () => {} },
			'quick-interrupted'
		);

		expect(store.getQuickAsk('quick-interrupted')?.status).toBe('dismissed');
		store.close();
	});

	it('does not let Quick Ask actions mutate an ordinary projectless Chat', async () => {
		const store = new HUEStore(':memory:');
		store.upsertSession(null, { sessionId: 'chat', cwd: '/work/chat', title: 'Ordinary Chat' });
		store.acceptMessage({
			id: 'chat-message',
			projectId: null,
			sessionId: 'chat',
			text: 'Hello',
			images: [],
			attachments: [],
			reviewContexts: []
		});

		expect(() => keepQuickAsk(store, 'chat-message')).toThrow('Quick Ask not found');
		await expect(
			discardQuickAsk(store, { cancelSession: async () => {}, whenIdle: async () => {} }, 'chat-message')
		).rejects.toThrow('Quick Ask not found');
		expect(store.getSession(null, 'chat')).not.toBeNull();
		store.close();
	});

	it('keeps the temporary Session recoverable when cancellation fails', async () => {
		const store = new HUEStore(':memory:');
		store.reserveQuickAsk('quick-running', 'hash');
		store.attachQuickAsk('quick-running', 'quick-session');
		store.upsertSession(null, { sessionId: 'quick-session', cwd: '/work/quick', title: 'Quick Ask' });
		store.updateSession(null, 'quick-session', { archived: true });
		store.acceptMessage({
			id: 'quick-running',
			projectId: null,
			sessionId: 'quick-session',
			text: quickAskPrompt('Still running'),
			images: [],
			attachments: [],
			reviewContexts: []
		});

		await expect(
			discardQuickAsk(store, {
				cancelSession: async () => { throw new Error('Cancel unavailable'); },
				whenIdle: async () => {}
			}, 'quick-running')
		).rejects.toThrow('Cancel unavailable');
		expect(store.getSession(null, 'quick-session')).not.toBeNull();
		store.close();
	});

	it('cancels a Hermes Session created outside the temporary folder', async () => {
		const store = new HUEStore(':memory:');
		let cancelled = '';
		const result = await generateQuickAsk(
			{ question: 'Question', operationId: 'quick-wrong-cwd', sessionRoot: '/work/quick' },
			{
				store,
				runtime: {
					createSession: async () => ({ sessionId: 'orphan', cwd: '/work/elsewhere' }),
					cancelSession: async (sessionId) => (cancelled = sessionId)
				},
				dispatcher: { submit: () => {}, whenIdle: async () => {} }
			}
		);

		expect(result.status).toBe('failed');
		expect(cancelled).toBe('orphan');
		store.close();
	});
});
