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

		expect(keepQuickAsk(store, 'quick-keep')).toMatchObject({
			sessionId: 'quick-session',
			title: 'Quick Ask',
			archived: false
		});
		store.close();
	});

	it('removes the temporary Session while retaining delivery state', async () => {
		const store = new HUEStore(':memory:');
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

		await discardQuickAsk(store, { cancelSession: async (sessionId) => (cancelled = sessionId) }, 'quick-discard');

		expect(cancelled).toBe('quick-session');
		expect(store.getSession(null, 'quick-session')).toBeNull();
		expect(store.isSessionDismissed(null, 'quick-session')).toBeTrue();
		expect(store.getMessage('quick-discard')).not.toBeNull();
		store.close();
	});
});
