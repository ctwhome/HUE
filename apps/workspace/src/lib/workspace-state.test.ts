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
		for (const delivery of ['saving', 'accepted', 'running', 'reconnecting']) {
			expect(workspaceState.isTurnBusy(delivery)).toBe(true);
		}
		expect(workspaceState.isTurnBusy('completed')).toBe(false);
		expect(workspaceState.isTurnBusy('delivery unknown')).toBe(false);
	});
});
