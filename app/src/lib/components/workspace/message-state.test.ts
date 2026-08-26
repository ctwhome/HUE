import { beforeEach, expect, test } from 'bun:test';

Reflect.set(globalThis, '$state', <T>(value: T) => value);
const stored = new Map<string, string>();
Reflect.set(globalThis, 'localStorage', {
	getItem: (key: string) => stored.get(key) ?? null,
	setItem: (key: string, value: string) => stored.set(key, value),
	removeItem: (key: string) => stored.delete(key)
});

const { ApiError, MessageState } = await import('./message-state.svelte');

beforeEach(() => stored.clear());

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

function raceHarness() {
	let projectId = 'origin-project';
	let sessionId = 'origin-session';
	let generation = 1;
	const response = deferred<{
		duplicate: boolean;
		status: string;
		workMode: 'live';
	}>();
	const busyCalls: Array<[string, string | null, string | null]> = [];
	const errors: string[] = [];
	const cached = new Map<string, { activeMessageId: string; delivery: string }>();
	const session = {
		activeMessageId: '',
		pendingAssistant: '',
		pendingImages: [],
		pendingThought: '',
		delivery: '',
		transcript: [],
		timeline: [],
		applyEvents() {},
		updateCachedDelivery(
			originProjectId: string | null,
			originSessionId: string,
			activeMessageId: string,
			delivery: string
		) {
			cached.set(`${originProjectId}:${originSessionId}`, { activeMessageId, delivery });
		}
	};
	const navigation = {
		captureSessionSelection: () => ({ generation, projectId, sessionId }),
		isCurrentSessionSelection: (selection: {
			generation: number;
			projectId: string | null;
			sessionId: string;
		}) =>
			selection.generation === generation &&
			selection.projectId === projectId &&
			selection.sessionId === sessionId,
		sessionApiPath: (id: string, suffix = '') =>
			`/api/projects/${projectId}/sessions/${id}${suffix}`,
		setSessionBusySince: (id: string, value: string | null, scope: string | null) =>
			busyCalls.push([id, value, scope]),
		replaceSession() {},
		openSession: async () => {},
		loadActiveTab: async () => {}
	};
	const state = new MessageState({
		api: () => response.promise,
		getProject: () => ({ id: projectId }),
		getSession: () => ({ sessionId }),
		getNavigation: () => navigation,
		session,
		transcriptFollow: { scrollToLatest: async () => {} },
		prepareVoice() {},
		applyVoiceEvents() {},
		focusComposer() {},
		setError: (message: string) => errors.push(message),
		setLoading() {}
	} as never);
	state.startPolling = () => {};
	state.composer = 'origin message';
	state.saveCurrentDraft();
	state.pendingEnvelope = {
		id: 'origin-message',
		projectId: 'origin-project',
		sessionId: 'origin-session',
		text: 'origin message',
		images: [],
		attachments: [],
		reviewContexts: []
	};
	stored.set('hue:pending:origin-project:origin-session', JSON.stringify(state.pendingEnvelope));
	return {
		state,
		session,
		response,
		busyCalls,
		errors,
		switchSelection() {
			cached.set('origin-project:origin-session', {
				activeMessageId: session.activeMessageId,
				delivery: session.delivery
			});
			projectId = 'destination-project';
			sessionId = 'destination-session';
			generation++;
			session.activeMessageId = 'destination-message';
			session.delivery = 'destination-delivery';
			state.composer = 'destination draft';
			state.pendingEnvelope = null;
		},
		returnToOrigin() {
			projectId = 'origin-project';
			sessionId = 'origin-session';
			generation++;
			const origin = cached.get('origin-project:origin-session')!;
			session.activeMessageId = origin.activeMessageId;
			session.delivery = origin.delivery;
			state.restoreDraft();
		}
	};
}

test('sendText ignores a stale successful POST response after selection changes', async () => {
	const harness = raceHarness();
	const sent = harness.state.sendText('origin message');
	harness.switchSelection();
	harness.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });

	expect(await sent).toBe(false);
	expect(harness.session.activeMessageId).toBe('destination-message');
	expect(harness.session.delivery).toBe('destination-delivery');
	expect(harness.session.transcript).toEqual([]);
	expect(harness.state.composer).toBe('destination draft');
	expect(harness.busyCalls).toHaveLength(1);
	expect(harness.busyCalls[0][0]).toBe('origin-session');
	expect(harness.busyCalls[0][1]).toBeString();
	expect(harness.busyCalls[0][2]).toBe('origin-project');

	harness.returnToOrigin();
	expect(harness.state.composer).toBe('');
	expect(harness.state.pendingEnvelope).toBeNull();
	expect(harness.session.delivery).toBe('accepted');
	expect(harness.session.activeMessageId).toBeString();
});

test('sendText ignores a stale failed POST response after selection changes', async () => {
	const harness = raceHarness();
	const sent = harness.state.sendText('origin message');
	harness.switchSelection();
	harness.response.reject(new Error('network failed'));

	expect(await sent).toBe(false);
	expect(harness.session.activeMessageId).toBe('destination-message');
	expect(harness.session.delivery).toBe('destination-delivery');
	expect(harness.state.pendingEnvelope).toBeNull();
	expect(harness.state.composer).toBe('destination draft');
	expect(harness.errors).toEqual([]);

	harness.returnToOrigin();
	expect(harness.state.composer).toBe('origin message');
	const pendingEnvelope = harness.state.pendingEnvelope;
	expect(pendingEnvelope).toEqual(
		expect.objectContaining({ text: 'origin message', sessionId: 'origin-session' })
	);
	expect(harness.session.delivery).toBe('delivery unknown');
	expect(harness.session.activeMessageId).toBe(pendingEnvelope!.id);
	expect(harness.busyCalls.at(-1)).toEqual(['origin-session', null, 'origin-project']);
});

test('sendText records a stale rejected POST only on the origin', async () => {
	const harness = raceHarness();
	const sent = harness.state.sendText('origin message');
	harness.switchSelection();
	harness.response.reject(new ApiError('not accepted'));

	expect(await sent).toBe(false);
	expect(harness.session.activeMessageId).toBe('destination-message');
	expect(harness.session.delivery).toBe('destination-delivery');
	expect(harness.state.composer).toBe('destination draft');
	expect(harness.errors).toEqual([]);

	harness.returnToOrigin();
	expect(harness.state.composer).toBe('origin message');
	expect(harness.state.pendingEnvelope).toBeNull();
	expect(harness.session.activeMessageId).toBe('');
	expect(harness.session.delivery).toBe('not accepted');
	expect(harness.busyCalls.at(-1)).toEqual(['origin-session', null, 'origin-project']);
});
