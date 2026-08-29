import { expect, test } from 'bun:test';
import { HUEStore } from './store';

test('initial Session snapshots compact replay without losing final state or cursor', () => {
	const store = new HUEStore(':memory:');
	store.ensureProjectMetadata('hue', 'HUE');
	store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
	store.acceptMessage({
		id: 'message-1',
		projectId: 'hue',
		sessionId: 'session-1',
		text: 'Ship it',
		images: [],
		attachments: [],
		reviewContexts: []
	});
	store.transitionMessage('message-1', 'running', { messageId: 'message-1' });
	store.appendEvent('hue', 'session-1', 'agent.chunk', {
		messageId: 'message-1',
		text: 'Hel'
	});
	store.appendEvent('hue', 'session-1', 'agent.chunk', {
		messageId: 'message-1',
		text: 'lo'
	});
	store.appendEvent('hue', 'session-1', 'agent.tool', {
		messageId: 'message-1',
		id: 'tool-1',
		name: 'Read',
		status: 'running'
	});
	store.appendEvent('hue', 'session-1', 'agent.chunk', {
		messageId: 'message-1',
		text: ' world'
	});
	store.appendEvent('hue', 'session-1', 'agent.tool', {
		messageId: 'message-1',
		id: 'tool-1',
		status: 'completed',
		result: 'ok'
	});

	const snapshot = store.getSessionSnapshot('hue', 'session-1');
	const chunks = snapshot.events.filter(({ type }) => type === 'agent.chunk');
	const tools = snapshot.events.filter(({ type }) => type === 'agent.tool');

	expect(chunks.map(({ payload }) => payload.text)).toEqual(['Hello', ' world']);
	expect(tools).toHaveLength(1);
	expect(tools[0]?.payload).toMatchObject({
		messageId: 'message-1',
		id: 'tool-1',
		name: 'Read',
		status: 'completed',
		result: 'ok'
	});
	expect(snapshot.activeTurn?.output).toBe('Hello world');
	expect(snapshot.cursor).toBe(store.listEvents('hue', 'session-1').at(-1)!.sequence);
	store.close();
});

test('initial replay keeps reused activity ids distinct across messages', () => {
	const store = new HUEStore(':memory:');
	store.ensureProjectMetadata('hue', 'HUE');
	store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
	store.appendEvent('hue', 'session-1', 'agent.tool', {
		messageId: 'message-1',
		id: 'tool-1',
		status: 'completed'
	});
	store.appendEvent('hue', 'session-1', 'agent.tool', {
		messageId: 'message-2',
		id: 'tool-1',
		status: 'completed'
	});

	expect(
		store
			.getSessionSnapshot('hue', 'session-1')
			.events.filter(({ type }) => type === 'agent.tool')
			.map(({ payload }) => payload.messageId)
	).toEqual(['message-1', 'message-2']);
	store.close();
});
