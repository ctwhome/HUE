import { describe, expect, it } from 'bun:test';
import {
	DeliveryUncertainError,
	MessageDispatcher,
	TurnCancelledError,
	type PromptRuntime
} from './message-dispatcher';
import { HUEStore } from './store';

class RecordingRuntime implements PromptRuntime {
	calls: Array<{
		sessionId: string;
		text: string;
		images?: unknown[];
		attachments?: unknown[];
		reviewContexts?: unknown[];
		workMode?: string;
	}> = [];
	resumes: Array<{ cwd: string; sessionId: string }> = [];
	loadedSessions: Set<string>;
	active = 0;
	maxActive = 0;
	failure: Error | null = null;

	constructor(loaded = true) {
		this.loadedSessions = new Set(loaded ? ['session-1'] : []);
	}

	hasSessionState(sessionId: string): boolean {
		return this.loadedSessions.has(sessionId);
	}

	async resumeSession(cwd: string, sessionId: string): Promise<void> {
		this.resumes.push({ cwd, sessionId });
		this.loadedSessions.add(sessionId);
	}

	async prompt(input: Parameters<PromptRuntime['prompt']>[0]): Promise<void> {
		this.calls.push({
			sessionId: input.sessionId,
			text: input.text,
			images: input.images,
			workMode: input.workMode,
			...(input.attachments?.length ? { attachments: input.attachments } : {}),
			...(input.reviewContexts?.length ? { reviewContexts: input.reviewContexts } : {})
		});
		this.active += 1;
		this.maxActive = Math.max(this.maxActive, this.active);
		await Promise.resolve();
		if (this.failure) {
			this.active -= 1;
			throw this.failure;
		}
		input.onChunk('Complete ');
		input.onImage?.({ name: 'Hermes image', mimeType: 'image/png', data: 'aGVsbG8=' });
		input.onThought?.('Checking files.');
		input.onTool?.({
			id: 'tool-1',
			name: 'read_file',
			title: 'Read file',
			kind: 'read',
			status: 'completed',
			args: { path: 'README.md' },
			result: 'Done',
			startedAt: 1,
			completedAt: 3,
			durationMs: 2
		});
		input.onPlan?.([{ content: 'Inspect files', priority: 'high', status: 'completed' }]);
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
	store.ensureProjectMetadata('hue', 'HUE');
	store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
	return store;
}

describe('MessageDispatcher', () => {
	it('loads an uncached existing Session before delivering a new message', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime(false);
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({
			id: 'existing-session-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Continue'
		});
		await dispatcher.whenIdle('session-1');

		expect(runtime.resumes).toEqual([{ cwd: '/work/hue', sessionId: 'session-1' }]);
		store.close();
	});

	it('delivers stored review contexts separately from user text', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);
		const reviewContexts = [
			{
				id: 'review-1',
				source: 'assistant' as const,
				label: 'Hermes response',
				content: 'Bounded quote',
				comment: 'Address this.'
			}
		];

		dispatcher.submit({
			id: 'review-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Please revise.',
			reviewContexts
		});
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls[0]).toMatchObject({ text: 'Please revise.', reviewContexts });
		store.close();
	});

	it('triggers attention delivery after projecting a new terminal event', async () => {
		const store = makeStore();
		let deliveries = 0;
		const dispatcher = new MessageDispatcher(store, new RecordingRuntime(), async () => {
			deliveries += 1;
		});

		dispatcher.submit({ id: 'notify', projectId: 'hue', sessionId: 'session-1', text: 'Finish' });
		await dispatcher.whenIdle('session-1');

		expect(store.notificationCounts()).toEqual({ unread: 1, all: 1 });
		expect(deliveries).toBeGreaterThanOrEqual(1);
		store.close();
	});

	it('recovers legacy work after its project session is discovered', async () => {
		const store = new HUEStore(':memory:');
		store.ensureProjectMetadata('hue', 'HUE');
		const now = new Date().toISOString();
		const insert = store.database.query(
			'INSERT INTO messages (id, session_id, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
		);
		insert.run('queued', 'session-1', 'Resume me', 'queued', now, now);
		insert.run('running', 'session-1', 'Do not retry me', 'running', now, now);
		const runtime = new RecordingRuntime(false);
		const dispatcher = new MessageDispatcher(store, runtime);

		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
		expect(store.getMessage('running')?.status).toBe('running');
		dispatcher.recover();
		dispatcher.recover();
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls).toEqual([
			{ sessionId: 'session-1', text: 'Resume me', images: [], workMode: 'autonomous' }
		]);
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
		store.ensureProjectMetadata('hue', 'HUE');
		store.upsertSession('hue', { sessionId: 'session-1', cwd: '/work/hue' });
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
		const runtime = new RecordingRuntime(false);

		const dispatcher = new MessageDispatcher(store, runtime);
		await dispatcher.whenIdle('session-1');

		expect(runtime.resumes).toEqual([{ cwd: '/work/hue', sessionId: 'session-1' }]);
		expect(runtime.calls).toEqual([
			{ sessionId: 'session-1', text: 'Resume me once', images: [], workMode: 'autonomous' }
		]);
		expect(store.getMessage('queued')?.status).toBe('completed');
		expect(store.getMessage('running')?.status).toBe('unknown');
		expect(store.listEvents('hue', 'session-1').at(-1)?.type).toBe('message.completed');
		expect(
			store.listEvents('hue', 'session-1').find((event) => event.type === 'message.unknown')
				?.payload
		).toEqual({ messageId: 'running', error: 'HUE restarted during Hermes delivery' });
		store.close();
	});

	it('restart atomically cancels every interrupted interaction before replay rejects stale answers', () => {
		const store = makeStore();
		store.acceptMessage({
			id: 'running',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Wait for user input'
		});
		store.updateMessageStatus('running', 'running');
		store.appendEvent('hue', 'session-1', 'agent.permission', {
			id: 'permission-1',
			messageId: 'running',
			status: 'pending'
		});
		store.appendEvent('hue', 'session-1', 'agent.clarify', {
			id: 'clarify-1',
			messageId: 'running',
			status: 'pending'
		});

		const restarted = new MessageDispatcher(store, new RecordingRuntime());
		const terminalEvents = store
			.listEvents('hue', 'session-1')
			.filter((event) =>
				['agent.permission', 'agent.clarify', 'message.unknown'].includes(event.type)
			)
			.slice(-3);

		expect(terminalEvents.map(({ type, payload }) => [type, payload.status])).toEqual([
			['agent.permission', 'cancelled'],
			['agent.clarify', 'cancelled'],
			['message.unknown', undefined]
		]);
		expect(store.getSessionSnapshot('hue', 'session-1').activeTurn).toMatchObject({
			messageId: 'running',
			status: 'unknown'
		});
		expect(
			restarted.resolveInteraction('hue', 'session-1', 'permission-1', {
				kind: 'permission',
				optionId: 'allow_once'
			})
		).toBe(false);
		expect(
			restarted.resolveInteraction('hue', 'session-1', 'clarify-1', {
				kind: 'clarify',
				action: 'cancel'
			})
		).toBe(false);
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
		const runtime = new RecordingRuntime(false);
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
	it('settles a user-cancelled turn without reporting a failure', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		runtime.failure = new TurnCancelledError();
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({ id: 'cancelled', projectId: 'hue', sessionId: 'session-1', text: 'Stop' });
		await dispatcher.whenIdle('session-1');

		expect(store.getMessage('cancelled')?.status).toBe('cancelled');
		expect(store.listEvents('hue', 'session-1').at(-1)).toMatchObject({
			type: 'message.cancelled',
			payload: { messageId: 'cancelled' }
		});
		expect(store.getSessionIndicators('hue')['session-1']).toMatchObject({
			status: 'cancelled',
			attention: false,
			error: false
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
		expect(runtime.calls).toEqual([
			{ sessionId: 'session-1', text: envelope.text, images: [], workMode: 'autonomous' }
		]);
		expect(store.getMessage('msg-1')?.status).toBe('completed');
		expect(
			store
				.listEvents('hue', 'session-1')
				.filter((event) => event.type === 'agent.chunk')
				.map((event) => event.payload.text)
		).toEqual(['Complete ', 'answer.']);
		expect(
			store.listEvents('hue', 'session-1').find((event) => event.type === 'agent.image')?.payload
		).toEqual({
			messageId: 'msg-1',
			image: { name: 'Hermes image', mimeType: 'image/png', data: 'aGVsbG8=' }
		});
		expect(
			store.listEvents('hue', 'session-1').find((event) => event.type === 'agent.thought')?.payload
		).toEqual({ messageId: 'msg-1', text: 'Checking files.' });
		store.close();
	});

	it('reads current stored work mode at processing time, including queued mode changes', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		let releaseFirst!: () => void;
		runtime.prompt = async (input) => {
			runtime.calls.push({
				sessionId: input.sessionId,
				text: input.text,
				images: input.images,
				workMode: input.workMode
			});
			if (input.text === 'First') {
				await new Promise<void>((resolve) => (releaseFirst = resolve));
			}
			input.onChunk(input.text);
		};
		const dispatcher = new MessageDispatcher(store, runtime);
		dispatcher.submit({
			id: 'msg-1',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'First'
		});
		dispatcher.submit({
			id: 'msg-2',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Second'
		});
		await Promise.resolve();
		store.updateSessionWorkMode('hue', 'session-1', 'live', 'user');
		releaseFirst();

		await dispatcher.whenIdle('session-1');

		expect(runtime.calls.map(({ text, workMode }) => ({ text, workMode }))).toEqual([
			{ text: 'First', workMode: 'autonomous' },
			{ text: 'Second', workMode: 'live' }
		]);
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

		expect(runtime.calls).toEqual([
			{ sessionId: 'session-1', text: envelope.text, images, workMode: 'autonomous' }
		]);
		expect(store.getMessage(envelope.id)?.images).toEqual(images);
		store.close();
	});

	it('keeps generic bytes only in turn memory while persisting unavailable metadata', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);
		const attachment = {
			name: 'notes.md',
			mimeType: 'text/markdown',
			size: 5,
			data: 'aGVsbG8='
		};

		dispatcher.submit({
			id: 'file-message',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Review this',
			attachments: [attachment]
		});
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls).toEqual([
			{
				sessionId: 'session-1',
				text: 'Review this',
				images: [],
				attachments: [attachment],
				workMode: 'autonomous'
			}
		]);
		expect(store.getMessage('file-message')?.attachments).toEqual([
			{
				name: attachment.name,
				mimeType: attachment.mimeType,
				size: attachment.size,
				available: false,
				reattachRequired: true
			}
		]);
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

	it('persists redacted tool chronology and current Hermes plan', async () => {
		const store = makeStore();
		const dispatcher = new MessageDispatcher(store, new RecordingRuntime());

		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'Inspect' });
		await dispatcher.whenIdle('session-1');

		expect(store.listEvents('hue', 'session-1')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'agent.tool',
					payload: expect.objectContaining({ messageId: 'msg-1', id: 'tool-1' })
				}),
				expect.objectContaining({
					type: 'agent.plan',
					payload: {
						messageId: 'msg-1',
						entries: [{ content: 'Inspect files', priority: 'high', status: 'completed' }]
					}
				})
			])
		);
		store.close();
	});

	it('keeps approval pending across event replay until explicit allowed response', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		let outcome: unknown;
		runtime.prompt = async (input) => {
			outcome = await input.onInteraction?.({
				kind: 'permission',
				id: 'perm-1',
				sessionId: input.sessionId,
				toolCall: {
					id: 'perm-1',
					name: 'terminal',
					title: 'Run command',
					kind: 'execute',
					status: 'pending',
					args: { command: 'pwd' },
					startedAt: 1
				},
				options: [
					{ optionId: 'once', name: 'Allow once', kind: 'allow_once' },
					{ optionId: 'session', name: 'Allow for session', kind: 'allow_always' },
					{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }
				]
			});
		};
		const dispatcher = new MessageDispatcher(store, runtime);
		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'Run' });
		await Promise.resolve();
		await Promise.resolve();

		expect(store.listEvents('hue', 'session-1')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'agent.permission',
					payload: expect.objectContaining({ id: 'perm-1', status: 'pending' })
				})
			])
		);
		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'perm-1', {
				kind: 'permission',
				optionId: 'not-offered'
			})
		).toBe(false);
		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'perm-1', {
				kind: 'permission',
				optionId: 'session'
			})
		).toBe(true);
		await dispatcher.whenIdle('session-1');

		expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'session' } });
		expect(store.listEvents('hue', 'session-1').at(-2)).toMatchObject({
			type: 'agent.permission',
			payload: { id: 'perm-1', messageId: 'msg-1', status: 'resolved', decision: 'session' }
		});
		store.close();
	});

	it('rejects oversized clarify answers and preserves message chronology on resolution', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		let outcome: unknown;
		runtime.prompt = async (input) => {
			outcome = await input.onInteraction?.({
				kind: 'clarify',
				id: 'clarify-1',
				sessionId: input.sessionId,
				message: 'Add context',
				fields: [{ name: 'note', label: 'Note', control: 'text', required: true }]
			});
		};
		const dispatcher = new MessageDispatcher(store, runtime);
		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'Ask' });
		await Promise.resolve();
		await Promise.resolve();

		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'clarify-1', {
				kind: 'clarify',
				action: 'accept'
			} as never)
		).toBe(false);
		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'clarify-1', {
				kind: 'clarify',
				action: 'accept',
				content: { note: 'x'.repeat(10_001) }
			})
		).toBe(false);
		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'clarify-1', {
				kind: 'clarify',
				action: 'accept',
				content: { note: 'Safe context' }
			})
		).toBe(true);
		await dispatcher.whenIdle('session-1');

		expect(outcome).toEqual({ action: 'accept', content: { note: 'Safe context' } });
		expect(store.listEvents('hue', 'session-1').at(-2)).toMatchObject({
			type: 'agent.clarify',
			payload: { id: 'clarify-1', messageId: 'msg-1', status: 'resolved' }
		});
		store.close();
	});

	it('isolates same-id permission requests by Session and rejects malformed replies', async () => {
		const store = makeStore();
		store.upsertSession('hue', { sessionId: 'session-2', cwd: '/work/hue' });
		const runtime = new RecordingRuntime();
		const outcomes = new Map<string, unknown>();
		runtime.prompt = async (input) => {
			outcomes.set(
				input.sessionId,
				await input.onInteraction?.({
					kind: 'permission',
					id: 'shared-tool-id',
					sessionId: input.sessionId,
					toolCall: {
						id: 'shared-tool-id',
						name: 'terminal',
						title: 'Run command',
						kind: 'execute',
						status: 'pending',
						startedAt: 1
					},
					options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }]
				})
			);
		};
		const dispatcher = new MessageDispatcher(store, runtime);
		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'One' });
		dispatcher.submit({ id: 'msg-2', projectId: 'hue', sessionId: 'session-2', text: 'Two' });
		await Promise.resolve();
		await Promise.resolve();

		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'shared-tool-id', {
				kind: 'clarify',
				action: 'accept'
			} as never)
		).toBe(false);
		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'shared-tool-id', {
				kind: 'permission',
				optionId: 'once'
			})
		).toBe(true);
		expect(
			dispatcher.resolveInteraction('hue', 'session-2', 'shared-tool-id', {
				kind: 'permission',
				optionId: 'once'
			})
		).toBe(true);
		await Promise.all([dispatcher.whenIdle('session-1'), dispatcher.whenIdle('session-2')]);

		expect(outcomes.get('session-1')).toEqual({
			outcome: { outcome: 'selected', optionId: 'once' }
		});
		expect(outcomes.get('session-2')).toEqual({
			outcome: { outcome: 'selected', optionId: 'once' }
		});
		store.close();
	});

	it('cancels unresolved authority prompts when ACP delivery fails', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		runtime.prompt = async (input) => {
			void input.onInteraction?.({
				kind: 'permission',
				id: 'stale-permission',
				sessionId: input.sessionId,
				toolCall: {
					id: 'stale-permission',
					name: 'terminal',
					title: 'Run command',
					kind: 'execute',
					status: 'pending',
					startedAt: 1
				},
				options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }]
			});
			throw new DeliveryUncertainError('ACP disconnected before acknowledgement');
		};
		const dispatcher = new MessageDispatcher(store, runtime);
		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'Run' });
		await dispatcher.whenIdle('session-1');

		expect(
			dispatcher.resolveInteraction('hue', 'session-1', 'stale-permission', {
				kind: 'permission',
				optionId: 'once'
			})
		).toBe(false);
		expect(store.listEvents('hue', 'session-1')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'agent.permission',
					payload: expect.objectContaining({ id: 'stale-permission', status: 'cancelled' })
				})
			])
		);
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

	it('prevents delivery from starting during a Session-exclusive operation', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);
		let release!: () => void;
		const exclusive = dispatcher.withSessionLock(
			'session-1',
			() => new Promise<void>((resolve) => (release = resolve))
		);
		await Promise.resolve();

		dispatcher.submit({
			id: 'msg-after-lock',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Wait for snapshot'
		});
		await Promise.resolve();
		expect(runtime.calls).toEqual([]);

		release();
		await exclusive;
		await dispatcher.whenIdle('session-1');
		expect(runtime.calls.map(({ text }) => text)).toEqual(['Wait for snapshot']);
		store.close();
	});

	it('uses the latest explicitly edited queued envelope when its turn starts', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		let releaseFirst!: () => void;
		runtime.prompt = async (input) => {
			runtime.calls.push({
				sessionId: input.sessionId,
				text: input.text,
				images: input.images,
				attachments: input.attachments
			});
			if (input.text === 'First') await new Promise<void>((resolve) => (releaseFirst = resolve));
		};
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'First' });
		dispatcher.submit({
			id: 'msg-2',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Original',
			attachments: [{ name: 'old.txt', mimeType: 'text/plain', size: 3, data: 'b2xk' }]
		});
		await Promise.resolve();
		dispatcher.updateQueuedMessage('msg-2', {
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Edited',
			images: [],
			attachments: [{ name: 'new.txt', mimeType: 'text/plain', size: 3, data: 'bmV3' }]
		});
		releaseFirst();
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls.map(({ text }) => text)).toEqual(['First', 'Edited']);
		expect(runtime.calls[1]?.attachments).toEqual([
			{ name: 'new.txt', mimeType: 'text/plain', size: 3, data: 'bmV3' }
		]);
		store.close();
	});

	it('preserves turn-memory attachment bytes during a metadata-only queued edit', async () => {
		const store = makeStore();
		const runtime = new RecordingRuntime();
		let releaseFirst!: () => void;
		runtime.prompt = async (input) => {
			runtime.calls.push({
				sessionId: input.sessionId,
				text: input.text,
				images: input.images,
				attachments: input.attachments
			});
			if (input.text === 'First') await new Promise<void>((resolve) => (releaseFirst = resolve));
		};
		const dispatcher = new MessageDispatcher(store, runtime);

		dispatcher.submit({ id: 'msg-1', projectId: 'hue', sessionId: 'session-1', text: 'First' });
		dispatcher.submit({
			id: 'msg-2',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Original',
			attachments: [{ name: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'aGVsbG8=' }]
		});
		await Promise.resolve();
		dispatcher.updateQueuedMessage('msg-2', {
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Edited',
			images: []
		});
		releaseFirst();
		await dispatcher.whenIdle('session-1');

		expect(runtime.calls[1]).toMatchObject({
			text: 'Edited',
			attachments: [{ name: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'aGVsbG8=' }]
		});
		expect(store.getMessage('msg-2')?.attachments).toEqual([
			{
				name: 'notes.txt',
				mimeType: 'text/plain',
				size: 5,
				available: false,
				reattachRequired: true
			}
		]);
		store.close();
	});

	it('fails recovered generic attachments without sending metadata as content', async () => {
		const store = makeStore();
		store.acceptMessage({
			id: 'file',
			projectId: 'hue',
			sessionId: 'session-1',
			text: 'Review',
			attachments: [{ name: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'aGVsbG8=' }]
		});
		const runtime = new RecordingRuntime();
		const dispatcher = new MessageDispatcher(store, runtime);
		await dispatcher.whenIdle('session-1');
		expect(runtime.calls).toEqual([]);
		expect(store.getMessage('file')?.status).toBe('failed');
		expect(store.listEvents('hue', 'session-1').at(-1)?.payload.error).toBe(
			'Attachments unavailable after restart; reattach required'
		);
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

	it('stops queued work and drains an active turn during shutdown', async () => {
		const store = makeStore();
		let rejectActive!: (error: Error) => void;
		const runtime: PromptRuntime = {
			hasSessionState: () => true,
			resumeSession: async () => {},
			prompt: () => new Promise((_resolve, reject) => (rejectActive = reject))
		};
		const dispatcher = new MessageDispatcher(store, runtime);
		dispatcher.submit({ id: 'active', projectId: 'hue', sessionId: 'session-1', text: 'active' });
		dispatcher.submit({ id: 'queued', projectId: 'hue', sessionId: 'session-1', text: 'queued' });
		await Promise.resolve();
		const closing = dispatcher.close();
		expect(() =>
			dispatcher.submit({ id: 'late', projectId: 'hue', sessionId: 'session-1', text: 'late' })
		).toThrow('shutting down');
		rejectActive(new DeliveryUncertainError('ACP closed during shutdown'));
		await closing;

		expect(store.getMessage('active')?.status).toBe('unknown');
		expect(store.getMessage('queued')?.status).toBe('queued');
		expect(store.getMessage('late')).toBeNull();
		store.close();
	});
});
