import { describe, expect, it } from 'bun:test';
import * as workspaceState from './index';

describe('workspace async state', () => {
	it('exposes event, request, and turn guards', () => {
		expect(typeof workspaceState.applySessionEvents).toBe('function');
		expect(typeof workspaceState.runSingleFlight).toBe('function');
		expect(typeof workspaceState.isCurrentSessionRequest).toBe('function');
		expect(typeof workspaceState.isTurnBusy).toBe('function');
	});

	it('rejects replayed sequences at or behind the cursor', () => {
		const result = workspaceState.applySessionEvents(
			{
				cursor: 3,
				activeMessageId: 'msg-1',
				pendingAssistant: '',
				delivery: 'running',
				transcript: []
			},
			[
				{ sequence: 3, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'duplicate' } },
				{ sequence: 4, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'new' } }
			]
		);

		expect(result).toMatchObject({ cursor: 4, pendingAssistant: 'new' });
	});

	it('shows published Hermes reasoning while a turn is running and clears it on completion', () => {
		const running = workspaceState.applySessionEvents(
			{
				cursor: 0,
				activeMessageId: 'msg-1',
				pendingAssistant: '',
				pendingThought: '',
				delivery: 'accepted',
				transcript: []
			},
			[
				{ sequence: 1, type: 'message.running', payload: { messageId: 'msg-1' } },
				{
					sequence: 2,
					type: 'agent.thought',
					payload: { messageId: 'msg-1', text: 'Checking the relevant files.' }
				}
			]
		);

		expect(running).toMatchObject({
			delivery: 'running',
			pendingThought: 'Checking the relevant files.',
			pendingAssistant: ''
		});

		const completed = workspaceState.applySessionEvents(running, [
			{ sequence: 3, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'Done.' } },
			{ sequence: 4, type: 'message.completed', payload: { messageId: 'msg-1' } }
		]);
		expect(completed.pendingThought).toBe('');
		expect(completed.transcript).toEqual([{ role: 'assistant', text: 'Done.' }]);
	});

	it('keeps streamed assistant images with the completed response', () => {
		const image = { name: 'Hermes image', mimeType: 'image/png', data: 'aGVsbG8=' };
		const result = workspaceState.applySessionEvents(
			{
				cursor: 0,
				activeMessageId: 'msg-1',
				pendingAssistant: '',
				pendingImages: [],
				delivery: 'running',
				transcript: []
			},
			[
				{ sequence: 1, type: 'agent.image', payload: { messageId: 'msg-1', image } },
				{ sequence: 2, type: 'message.completed', payload: { messageId: 'msg-1' } }
			]
		);

		expect(result.pendingImages).toEqual([]);
		expect(result.transcript).toEqual([{ role: 'assistant', text: '', images: [image] }]);
	});

	it('replays and merges durable subagent tree updates', () => {
		const events = [
			{
				sequence: 2,
				type: 'agent.subagents',
				payload: {
					messageId: 'msg-1',
					id: 'delegate-1',
					title: '1 subagent',
					status: 'in_progress',
					children: [{ index: 0, goal: 'Inspect files', status: 'in_progress' }]
				}
			},
			{
				sequence: 3,
				type: 'agent.subagents',
				payload: {
					messageId: 'msg-1',
					id: 'delegate-1',
					title: '1 subagent',
					status: 'completed',
					children: [{ index: 0, goal: 'Inspect files', status: 'completed', result: 'Found it' }]
				}
			}
		];

		expect(workspaceState.subagentTreesFromEvents(events)).toEqual([
			{
				messageId: 'msg-1',
				id: 'delegate-1',
				title: '1 subagent',
				status: 'completed',
				children: [{ index: 0, goal: 'Inspect files', status: 'completed', result: 'Found it' }]
			}
		]);
	});

	it('keeps first-seen activity chronology while merging reconnect patches', () => {
		const events = [
			{
				sequence: 1,
				type: 'agent.tool',
				createdAt: '2026-08-22T10:00:00.000Z',
				payload: { messageId: 'msg-1', id: 'tool-1', title: 'Read', status: 'in_progress' }
			},
			{
				sequence: 2,
				type: 'agent.permission',
				createdAt: '2026-08-22T10:00:01.000Z',
				payload: { messageId: 'msg-1', id: 'permission-1', status: 'pending' }
			},
			{
				sequence: 3,
				type: 'agent.tool',
				createdAt: '2026-08-22T10:00:02.000Z',
				payload: { messageId: 'msg-1', id: 'tool-1', title: 'Read', status: 'completed' }
			}
		];

		expect(workspaceState.activityFromEvents(events)).toEqual([
			expect.objectContaining({
				kind: 'tool',
				id: 'tool-1',
				status: 'completed',
				createdAt: '2026-08-22T10:00:00.000Z'
			}),
			expect.objectContaining({ kind: 'permission', id: 'permission-1', status: 'pending' })
		]);
	});

	it('keeps messages and agent activity in one sequence-keyed timeline with patch-in-place updates', () => {
		const events = [
			{ sequence: 1, type: 'message.accepted', payload: { messageId: 'msg-1' } },
			{ sequence: 2, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'Before tool.' } },
			{
				sequence: 3,
				type: 'agent.tool',
				payload: { messageId: 'msg-1', id: 'tool-1', title: 'Read', status: 'in_progress' }
			},
			{ sequence: 4, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'After tool.' } },
			{
				sequence: 5,
				type: 'agent.plan',
				payload: {
					messageId: 'msg-1',
					entries: [{ content: 'Inspect', priority: 'high', status: 'in_progress' }]
				}
			},
			{
				sequence: 6,
				type: 'agent.permission',
				payload: { messageId: 'msg-1', id: 'permission-1', status: 'pending' }
			},
			{
				sequence: 7,
				type: 'agent.tool',
				payload: { messageId: 'msg-1', id: 'tool-1', title: 'Read', status: 'completed' }
			},
			{
				sequence: 8,
				type: 'agent.clarify',
				payload: { messageId: 'msg-1', id: 'clarify-1', status: 'pending' }
			},
			{
				sequence: 9,
				type: 'agent.subagents',
				payload: {
					messageId: 'msg-1',
					id: 'delegate-1',
					title: '1 subagent',
					status: 'in_progress',
					children: [{ index: 0, goal: 'Inspect', status: 'in_progress' }]
				}
			},
			{
				sequence: 10,
				type: 'agent.subagents',
				payload: {
					messageId: 'msg-1',
					id: 'delegate-1',
					title: '1 subagent',
					status: 'completed',
					children: [{ index: 0, goal: 'Inspect', status: 'completed', result: 'Done' }]
				}
			},
			{
				sequence: 11,
				type: 'agent.plan',
				payload: {
					messageId: 'msg-1',
					entries: [{ content: 'Inspect', priority: 'high', status: 'completed' }]
				}
			}
		];

		const timeline = workspaceState.timelineFromSession(
			[],
			[{ id: 'msg-1', text: 'Start', images: [], status: 'completed' }],
			events
		);

		expect(timeline.map(({ sequence, kind }) => [sequence, kind])).toEqual([
			[1, 'message'],
			[2, 'message'],
			[3, 'tool'],
			[4, 'message'],
			[5, 'plan'],
			[6, 'permission'],
			[8, 'clarify'],
			[9, 'subagents']
		]);
		expect(timeline[1]).toMatchObject({ role: 'assistant', text: 'Before tool.' });
		expect(timeline[2]).toMatchObject({ id: 'tool-1', status: 'completed' });
		expect(timeline[3]).toMatchObject({ role: 'assistant', text: 'After tool.' });
		expect(timeline[4]).toMatchObject({ entries: [{ status: 'completed' }] });
		expect(timeline[7]).toMatchObject({ id: 'delegate-1', status: 'completed' });
	});

	it('maps work mode changes into compact timeline status items', () => {
		const timeline = workspaceState.timelineFromSession(
			[],
			[],
			[
				{
					sequence: 1,
					type: 'session.work_mode_changed',
					createdAt: '2026-08-23T10:00:00.000Z',
					payload: { priorMode: 'autonomous', workMode: 'live', source: 'user' }
				}
			]
		);

		expect(timeline).toEqual([
			expect.objectContaining({
				sequence: 1,
				kind: 'status',
				statusType: 'work-mode',
				label: 'Work mode changed to Live',
				createdAt: '2026-08-23T10:00:00.000Z'
			})
		]);
	});

	it('deduplicates reconnect replay while appending new assistant segments in event order', () => {
		const initial = workspaceState.applyTimelineEvents(
			{ cursor: 2, timeline: [{ sequence: 2, kind: 'message', role: 'assistant', text: 'A' }] },
			[
				{ sequence: 2, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'A' } },
				{
					sequence: 3,
					type: 'agent.tool',
					payload: { messageId: 'msg-1', id: 'tool-1', status: 'in_progress' }
				},
				{ sequence: 4, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'B' } }
			]
		);
		const replayed = workspaceState.applyTimelineEvents(initial, [
			{
				sequence: 3,
				type: 'agent.tool',
				payload: { messageId: 'msg-1', id: 'tool-1', status: 'in_progress' }
			},
			{ sequence: 4, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'B' } },
			{
				sequence: 5,
				type: 'agent.tool',
				payload: { messageId: 'msg-1', id: 'tool-1', status: 'completed' }
			}
		]);

		expect(replayed.cursor).toBe(5);
		expect(replayed.timeline).toHaveLength(3);
		expect(replayed.timeline.map(({ sequence }) => sequence)).toEqual([2, 3, 4]);
		expect(replayed.timeline[1]).toMatchObject({ id: 'tool-1', status: 'completed' });
	});

	it('rekeys an optimistic user message to its accepted sequence before streamed output', () => {
		const result = workspaceState.applyTimelineEvents(
			{
				cursor: 0,
				timeline: [
					{
						sequence: Number.MAX_SAFE_INTEGER,
						kind: 'message',
						role: 'user',
						messageId: 'msg-1',
						text: 'Start'
					}
				]
			},
			[
				{ sequence: 1, type: 'message.accepted', payload: { messageId: 'msg-1' } },
				{ sequence: 2, type: 'agent.chunk', payload: { messageId: 'msg-1', text: 'Working' } }
			]
		);

		expect(result.timeline.map(({ sequence, kind }) => [sequence, kind])).toEqual([
			[1, 'message'],
			[2, 'message']
		]);
		expect(result.timeline[0]).toMatchObject({ role: 'user', text: 'Start' });
	});

	it('keeps repeated historical prompts before the HUE-owned replay boundary', () => {
		const timeline = workspaceState.timelineFromSession(
			[
				{ role: 'user', text: 'Repeat' },
				{ role: 'assistant', text: 'Earlier answer' },
				{ role: 'user', text: 'Repeat' },
				{ role: 'assistant', text: 'Current answer' }
			],
			[{ id: 'msg-1', text: 'Repeat', images: [], status: 'completed' }],
			[
				{ sequence: 1, type: 'message.accepted', payload: { messageId: 'msg-1' } },
				{
					sequence: 2,
					type: 'agent.chunk',
					payload: { messageId: 'msg-1', text: 'Current answer' }
				}
			]
		);

		expect(
			timeline.map((item) => [
				item.kind,
				'role' in item ? item.role : '',
				'text' in item ? item.text : ''
			])
		).toEqual([
			['message', 'user', 'Repeat'],
			['message', 'assistant', 'Earlier answer'],
			['message', 'user', 'Repeat'],
			['message', 'assistant', 'Current answer']
		]);
	});

	it('does not duplicate delivered transcript when a repeated prompt has a queued follow-up', () => {
		const timeline = workspaceState.timelineFromSession(
			[
				{ role: 'user', text: 'Repeat' },
				{ role: 'assistant', text: 'Earlier answer' },
				{ role: 'user', text: 'Repeat' },
				{ role: 'assistant', text: 'Current answer' }
			],
			[
				{ id: 'delivered', text: 'Repeat', images: [], status: 'completed' },
				{ id: 'queued', text: 'Follow up', images: [], status: 'queued' }
			],
			[
				{ sequence: 1, type: 'message.accepted', payload: { messageId: 'delivered' } },
				{ sequence: 2, type: 'message.running', payload: { messageId: 'delivered' } },
				{
					sequence: 3,
					type: 'agent.chunk',
					payload: { messageId: 'delivered', text: 'Current answer' }
				},
				{ sequence: 4, type: 'message.completed', payload: { messageId: 'delivered' } },
				{ sequence: 5, type: 'message.accepted', payload: { messageId: 'queued' } }
			]
		);

		expect(
			timeline.map((item) => [
				item.kind,
				'role' in item ? item.role : '',
				'text' in item ? item.text : ''
			])
		).toEqual([
			['message', 'user', 'Repeat'],
			['message', 'assistant', 'Earlier answer'],
			['message', 'user', 'Repeat'],
			['message', 'assistant', 'Current answer'],
			['message', 'user', 'Follow up']
		]);
	});

	it('keeps an absent unknown repeated prompt once across reconstruction and reconnect replay', () => {
		const events = [
			{ sequence: 1, type: 'message.accepted', payload: { messageId: 'completed' } },
			{ sequence: 2, type: 'message.running', payload: { messageId: 'completed' } },
			{
				sequence: 3,
				type: 'agent.chunk',
				payload: { messageId: 'completed', text: 'Earlier answer' }
			},
			{ sequence: 4, type: 'message.completed', payload: { messageId: 'completed' } },
			{ sequence: 5, type: 'message.accepted', payload: { messageId: 'unknown' } },
			{ sequence: 6, type: 'message.running', payload: { messageId: 'unknown' } },
			{
				sequence: 7,
				type: 'message.unknown',
				payload: { messageId: 'unknown', error: 'Delivery outcome unknown' }
			}
		];
		const timeline = workspaceState.timelineFromSession(
			[
				{ role: 'user', text: 'Repeat' },
				{ role: 'assistant', text: 'Earlier answer' }
			],
			[
				{ id: 'completed', text: 'Repeat', images: [], status: 'completed' },
				{ id: 'unknown', text: 'Repeat', images: [], status: 'unknown' }
			],
			events
		);

		expect(
			timeline.map((item) => [
				item.kind,
				'role' in item ? item.role : '',
				'text' in item ? item.text : '',
				'messageId' in item ? item.messageId : undefined
			])
		).toEqual([
			['message', 'user', 'Repeat', 'completed'],
			['message', 'assistant', 'Earlier answer', 'completed'],
			['message', 'user', 'Repeat', 'unknown']
		]);

		expect(workspaceState.applyTimelineEvents({ cursor: 7, timeline }, events.slice(4))).toEqual({
			cursor: 7,
			timeline
		});
	});

	it('preserves authoritative timestamps and omits unavailable historical times', () => {
		const timeline = workspaceState.timelineFromSession(
			[
				{ role: 'user', text: 'Undated history' },
				{
					role: 'assistant',
					text: 'Dated history',
					createdAt: '2026-08-21T09:00:00.000Z'
				},
				{ role: 'user', text: 'Current prompt' },
				{ role: 'assistant', text: 'Current answer' }
			],
			[
				{
					id: 'current',
					text: 'Current prompt',
					images: [],
					status: 'completed',
					createdAt: '2026-08-22T10:00:00.000Z'
				}
			],
			[
				{
					sequence: 1,
					type: 'message.accepted',
					createdAt: '2026-08-22T10:00:00.050Z',
					payload: { messageId: 'current' }
				},
				{
					sequence: 2,
					type: 'message.running',
					createdAt: '2026-08-22T10:00:00.100Z',
					payload: { messageId: 'current' }
				},
				{
					sequence: 3,
					type: 'agent.chunk',
					createdAt: '2026-08-22T10:00:01.000Z',
					payload: { messageId: 'current', text: 'Current ' }
				},
				{
					sequence: 4,
					type: 'agent.chunk',
					createdAt: '2026-08-22T10:00:02.000Z',
					payload: { messageId: 'current', text: 'answer' }
				}
			]
		);

		expect(timeline[0]).not.toHaveProperty('createdAt');
		expect(timeline[1]).toMatchObject({ createdAt: '2026-08-21T09:00:00.000Z' });
		expect(timeline[2]).toMatchObject({
			role: 'user',
			createdAt: '2026-08-22T10:00:00.000Z'
		});
		expect(timeline[3]).toMatchObject({
			role: 'assistant',
			text: 'Current answer',
			createdAt: '2026-08-22T10:00:01.000Z'
		});

		const streamed = workspaceState.applyTimelineEvents(
			{
				cursor: 0,
				timeline: [
					{
						sequence: Number.MAX_SAFE_INTEGER,
						kind: 'message',
						role: 'user',
						messageId: 'live',
						text: 'Live'
					}
				]
			},
			[
				{
					sequence: 5,
					type: 'message.accepted',
					createdAt: '2026-08-22T11:00:00.000Z',
					payload: { messageId: 'live' }
				},
				{
					sequence: 6,
					type: 'agent.chunk',
					createdAt: '2026-08-22T11:00:01.000Z',
					payload: { messageId: 'live', text: 'One' }
				},
				{
					sequence: 7,
					type: 'agent.chunk',
					createdAt: '2026-08-22T11:00:02.000Z',
					payload: { messageId: 'live', text: ' two' }
				}
			]
		);
		expect(streamed.timeline[0]).toMatchObject({ createdAt: '2026-08-22T11:00:00.000Z' });
		expect(streamed.timeline[1]).toMatchObject({
			text: 'One two',
			createdAt: '2026-08-22T11:00:01.000Z'
		});
		expect(
			workspaceState.applyTimelineEvents(streamed, [
				{
					sequence: 7,
					type: 'agent.chunk',
					createdAt: '2026-08-22T11:00:02.000Z',
					payload: { messageId: 'live', text: ' two' }
				}
			]).timeline
		).toEqual(streamed.timeline);
	});

	it('replaces active todo plan and clears it when Hermes removes every item', () => {
		const initial = workspaceState.applySessionEvents(
			{
				cursor: 0,
				activeMessageId: 'msg-1',
				pendingAssistant: '',
				delivery: 'running',
				transcript: [],
				activity: [],
				plan: []
			},
			[
				{
					sequence: 1,
					type: 'agent.plan',
					payload: {
						messageId: 'msg-1',
						entries: [{ content: 'Inspect', priority: 'high', status: 'in_progress' }]
					}
				}
			]
		);
		expect(initial.plan).toEqual([{ content: 'Inspect', priority: 'high', status: 'in_progress' }]);
		expect(
			workspaceState.applySessionEvents(initial, [
				{ sequence: 2, type: 'agent.plan', payload: { messageId: 'msg-1', entries: [] } }
			]).plan
		).toEqual([]);
	});

	it('runs overlapping polls as one in-flight request', async () => {
		let resolve!: () => void;
		let calls = 0;
		const holder: { current: Promise<void> | null } = { current: null };
		const task = () => {
			calls += 1;
			return new Promise<void>((done) => (resolve = done));
		};

		const first = workspaceState.runSingleFlight(holder, task);
		const second = workspaceState.runSingleFlight(holder, task);
		expect(second).toBe(first);
		expect(calls).toBe(1);
		resolve();
		await first;
		expect(holder.current).toBeNull();
	});

	it('accepts only the latest selected project and session response', () => {
		const current = { generation: 3, projectId: 'hue', sessionId: 'new' };
		expect(
			workspaceState.isCurrentSessionRequest(
				{ generation: 2, projectId: 'hue', sessionId: 'old' },
				current
			)
		).toBe(false);
		expect(workspaceState.isCurrentSessionRequest(current, current)).toBe(true);
	});

	it('keeps the latest Project tab when responses arrive in reverse order', async () => {
		type Request = { generation: number; projectId: string; tab: 'sessions' | 'workflows' };
		let current: Request = { generation: 1, projectId: 'hue', tab: 'sessions' };
		let visible = '';
		let resolveSessions!: (value: string) => void;
		let resolveWorkflows!: (value: string) => void;
		const sessions = new Promise<string>((resolve) => (resolveSessions = resolve));
		const workflows = new Promise<string>((resolve) => (resolveWorkflows = resolve));
		const commit = async (request: Request, response: Promise<string>) => {
			const value = await response;
			if (workspaceState.isCurrentTabRequest(request, current)) visible = value;
		};

		const slow = commit(current, sessions);
		current = { generation: 2, projectId: 'hue', tab: 'workflows' };
		const fast = commit(current, workflows);
		resolveWorkflows('workflows');
		await fast;
		resolveSessions('sessions');
		await slow;

		expect(visible).toBe('workflows');
	});

	it('locks submission throughout accepted, running, and reconnecting delivery', () => {
		for (const delivery of ['saving', 'accepted', 'running', 'reconnecting', 'cancelling']) {
			expect(workspaceState.isTurnBusy(delivery)).toBe(true);
		}
		expect(workspaceState.isTurnBusy('completed')).toBe(false);
		expect(workspaceState.isTurnBusy('delivery unknown')).toBe(false);
	});

	it('formats compact elapsed session times', () => {
		const startedAt = '2026-08-21T16:36:41.000Z';
		expect(workspaceState.formatElapsed(startedAt, Date.parse('2026-08-21T16:36:41.000Z'))).toBe(
			'0s'
		);
		expect(workspaceState.formatElapsed(startedAt, Date.parse('2026-08-21T16:38:40.000Z'))).toBe(
			'1m 59s'
		);
		expect(workspaceState.formatElapsed(startedAt, Date.parse('2026-08-21T17:38:40.000Z'))).toBe(
			'1h 1m'
		);
	});
});
