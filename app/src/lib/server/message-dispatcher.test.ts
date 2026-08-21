import { describe, expect, it } from 'bun:test';
import {
	DeliveryUncertainError,
	MessageDispatcher,
	type PromptRuntime
} from './message-dispatcher';
import { HUEStore } from './store';

class RecordingRuntime implements PromptRuntime {
	calls: Array<{ sessionId: string; text: string; images?: unknown[] }> = [];
	resumes: Array<{ cwd: string; sessionId: string }> = [];
	active = 0;
	maxActive = 0;
	failure: Error | null = null;

	async resumeSession(cwd: string, sessionId: string): Promise<void> {
		this.resumes.push({ cwd, sessionId });
	}

	async prompt(input: Parameters<PromptRuntime['prompt']>[0]): Promise<void> {
		this.calls.push({ sessionId: input.sessionId, text: input.text, images: input.images });
		this.active += 1;
		this.maxActive = Math.max(this.maxActive, this.active);
		await Promise.resolve();
		if (this.failure) {
			this.active -= 1;
			throw this.failure;
		}
		input.onChunk('Complete ');
		input.onThought?.('Checking files.');
		input.onSubagent?.({
			id: 'delegate-1',
			title: '1 subagent',
			status: 'completed',
			children: [{ index: 0, goal: 'Inspect files', status: 'completed', result: 'Found it' }]
		});
		input.onChunk('answer.');
		this.active -= 1;
	}
}

function makeStore() {
	const store = new HUEStore(':memory:');
	store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
	store.upsertProjectSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
	return store;
}

describe('MessageDispatcher', () => {
	it('recovers legacy work after its project session is discovered', async () => {
		const store = new HUEStore(':memory:');
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		const now = new Date().toISOString();
		const insert = store.database.query(
			'INSERT INTO messages (id, session_id, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
		);
		insert.run('queued', 'session-1', 'Resume me', 'queued', now, now);
		insert.run('running', 'session-1', 'Do not retry me', 'running', now, now);
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);

		store.upsertProjectSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
		expect(store.getMessage('running')?.status).toBe('running');
		dispatcher.recover();
		dispatcher.recover();
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls).toEqual([{ sessionId: 'session-1', text: 'Resume me', images: [] }]);
		expect(store.getMessage('queued')?.status).toBe('completed');
		expect(store.getMessage('running')?.status).toBe('unknown');
		expect(
			store
				.listEvents('hue', 'session-1')
				.filter(
					(event) => event.type === 'message.unknown' && event.payload.messageId === 'running'
				)
		).toHaveLength(1);
		store.close();
	});

	it('does not interrupt live running work during session discovery', async () => {
		const store = new HUEStore(':memory:');
		store.createProject({ id: 'hue', name: 'HUE', rootPath: '/work/hue' });
		store.upsertProjectSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
		let finishPrompt!: () => void;
		const runtime = new RecordingRuntime();
		runtime.prompt = async (input) => {
			runtime.calls.push({ sessionId: input.sessionId, text: input.text, images: input.images });
			await new Promise<void>((resolve) => (finishPrompt = resolve));
		};
		const dispatcher = new MessageDispatcher(store, runtime);
		dispatcher.submit({
			id: 'running',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Still active'
		});
		await Promise.resolve();

		dispatcher.recover();

		expect(store.getMessage('running')?.status).toBe('running');
		finishPrompt();
		await dispatcher.whenIdle('session-1');
		store.close();
	});

	it('recovers queued work once and marks interrupted running work unknown', async () => {
		const store = makeStore();
		store.acceptMessage({
			id: 'queued',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Resume me once'
		});
		store.acceptMessage({
			id: 'running',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Never retry me'
		});
		store.updateMessageStatus('running', 'running');
		const runtime = new RecordingRuntime();

		const dispatcher = new MessageDispatcher(store, runtime);
		await dispatcher.whenIdle('session-1');

		expect(runtime.resumes).toEqual([{ cwd: '/work/hue', sessionId: 'session-1' }]);
		expect(runtime.calls).toEqual([{ sessionId: 'session-1', text: 'Resume me once', images: [] }]);
		expect(store.getMessage('queued')?.status).toBe('completed');
		expect(store.getMessage('running')?.status).toBe('unknown');
		expect(store.listEvents('hue', 'session-1').at(-1)?.type).toBe('message.completed');
		expect(
			store.listEvents('hue', 'session-1').find((event) => event.type === 'message.unknown')
				?.payload
		).toEqual({ messageId: 'running', error: 'HUE restarted during Hermes delivery' });
		store.close();
	});

	it('records a failed recovered turn when Hermes cannot resume it', async () => {
		const store = makeStore();
		store.acceptMessage({
			id: 'queued',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Resume safely'
		});
		const runtime = new RecordingRuntime();
		runtime.resumeSession = async () => {
			throw new Error('resume unavailable');
		};

		const dispatcher = new MessageDispatcher(store, runtime);
		await dispatcher.whenIdle('session-1');

		expect(store.getMessage('queued')?.status).toBe('failed');
		expect(store.listEvents('hue', 'session-1').at(-1)).toMatchObject({
			type: 'message.failed',
			payload: { messageId: 'queued', error: 'resume unavailable' }
		});
		store.close();
	});
	it('submits an exact envelope only once across client retries', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);
		const envelope = {
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Full mobile message with its final words intact.'
		};

		const first = dispatcher.submit(envelope);
		const retry = dispatcher.submit(envelope);
		await dispatcher.whenIdle('session-1');

		expect(first).toMatchObject({ duplicate: false, status: 'queued' });
		expect(retry.duplicate).toBe(true);
		expect(runtime.calls).toEqual([{ sessionId: 'session-1', text: envelope.text, images: [] }]);
		expect(store.getMessage('msg-1')?.status).toBe('completed');
		expect(
			store
				.listEvents('hue', 'session-1')
				.filter((event) => event.type === 'agent.chunk')
				.map((event) => event.payload.text)
		).toEqual(['Complete ', 'answer.']);
		expect(
			store.listEvents('hue', 'session-1').find((event) => event.type === 'agent.thought')?.payload
		).toEqual({ messageId: 'msg-1', text: 'Checking files.' });
		store.close();
	});

	it('persists and forwards image attachments as part of the exact envelope', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);
		const images = [{ name: 'screen.png', mimeType: 'image/png', data: 'aGVsbG8=' }];
		const envelope = {
			id: 'image-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Review this screenshot',
			images
		};

		dispatcher.submit(envelope);
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls).toEqual([{ sessionId: 'session-1', text: envelope.text, images }]);
		expect(store.getMessage(envelope.id)?.images).toEqual(images);
		store.close();
	});

	it('persists delegate_task child status and results', async () => {
		const store = makeStore();
		const dispatcher = new MessageDispatcher(store, new RecordingRuntime());

		dispatcher.submit({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Delegate it'
		});
		await dispatcher.whenIdle('session-1');

		expect(
			store.listEvents('hue', 'session-1').find((event) => event.type === 'agent.subagents')
		).toMatchObject({
			payload: {
				messageId: 'msg-1',
				id: 'delegate-1',
				status: 'completed',
				children: [{ goal: 'Inspect files', status: 'completed', result: 'Found it' }]
			}
		});
		store.close();
	});

	it('serializes messages within one Hermes session', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'First' });
		dispatcher.submit({ id: 'msg-2', projectId: 'hue', sessionId: 'session-1', text: 'Second' });
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls.map((call) => call.text)).toEqual(['First', 'Second']);
		expect(runtime.maxActive).toBe(1);
		store.close();
	});

	it('uses the latest explicitly edited queued envelope when its turn starts', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		let releaseFirst!: () => void;
		runtime.prompt = async (input) => {
			runtime.calls.push({ sessionId: input.sessionId, text: input.text, images: input.images });
			if (input.text === 'First') await new Promise<void>((resolve) => (releaseFirst = resolve));
		};
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'First' });
		dispatcher.submit({ id: 'msg-2', projectId: 'hue', sessionId: 'session-1', text: 'Original' });
		await Promise.resolve();
		store.updateQueuedMessage('msg-2', {
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Edited',
			images: []
		});
		releaseFirst();
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls.map(({ text }) => text)).toEqual(['First', 'Edited']);
		store.close();
	});

	it('persists a failed terminal state and diagnostic event', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		runtime.failure = new Error('runtime unavailable');
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'Try once' });
		await dispatcher.whenIdle('session-1');

		expect(store.getMessage('msg-1')?.status).toBe('failed');
		expect(store.listEvents('hue', 'session-1').at(-1)).toMatchObject({
			type: 'message.failed',
			payload: { messageId: 'msg-1', error: 'runtime unavailable' }
		});
		store.close();
	});

	it('marks transport loss as unknown instead of retrying an uncertain prompt', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		runtime.failure = new DeliveryUncertainError('ACP disconnected before acknowledgement');
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Do not execute twice'
		});
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls).toHaveLength(1);
		expect(store.getMessage('msg-1')?.status).toBe('unknown');
		expect(store.listEvents('hue', 'session-1').at(-1)).toMatchObject({
			type: 'message.unknown',
			payload: { messageId: 'msg-1', error: 'ACP disconnected before acknowledgement' }
		});
		store.close();
	});
});
