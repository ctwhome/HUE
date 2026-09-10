import { beforeEach, expect, test } from 'bun:test';

Reflect.set(globalThis, '$state', <T>(value: T) => value);
const stored = new Map<string, string>();
Reflect.set(globalThis, 'localStorage', {
	getItem: (key: string) => stored.get(key) ?? null,
	setItem: (key: string, value: string) => stored.set(key, value),
	removeItem: (key: string) => stored.delete(key)
});

const { ApiError, MessageState } = await import('./message-state.svelte');

beforeEach(() => {
	stored.clear();
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => stored.set(key, value),
			removeItem: (key: string) => stored.delete(key)
		}
	});
});

test('clear removes notices from the previous session', () => {
	const state = new MessageState({} as never);
	state.messageNotice = 'Code copied';

	state.clear();

	expect(state.messageNotice).toBe('');
});

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
	const requests: RequestInit[] = [];
	const cached = new Map<string, { activeMessageId: string; delivery: string }>();
	const session = {
		activeMessageId: '',
		pendingAssistant: '',
		pendingImages: [],
		pendingThought: '',
		delivery: '',
		transcript: [],
		timeline: [] as import('$lib').WorkspaceTimelineItem[],
		queuedMessages: [] as Array<{ id: string }>,
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
		applySessionInfoEvents() {},
		openSession: async () => {},
		loadActiveTab: async () => {}
	};
	const state = new MessageState({
		api: (_path: string, init: RequestInit) => {
			requests.push(init);
			return response.promise;
		},
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
		requests,
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

test('acknowledgement preserves a newer same-session draft', async () => {
	const h = raceHarness();
	const sent = h.state.submit({ preventDefault() {} } as SubmitEvent);
	h.state.composer = 'newer draft';
	h.state.saveCurrentDraft();
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await sent;
	expect(h.state.composer).toBe('newer draft');
	expect(stored.get('hue:draft:origin-project:origin-session')).toBe('newer draft');
});

test('returning to the origin before acknowledgement preserves newer review context', async () => {
	const h = raceHarness();
	const sent = h.state.sendText('origin message');
	h.switchSelection();
	h.returnToOrigin();
	h.state.addReviewContext({ source: 'assistant', label: 'New context', content: 'Keep this' });
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await sent;
	expect(stored.get('hue:contexts:origin-project:origin-session')).toContain('Keep this');
});

test('draft revision survives editing away and back while acknowledgement is pending', async () => {
	const h = raceHarness();
	const sent = h.state.submit({ preventDefault() {} } as SubmitEvent);
	h.state.composer = 'intermediate';
	h.state.composer = 'origin message';
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await sent;
	expect(h.state.composer).toBe('origin message');
});

test('attachment revisions survive removing and restoring the same selection', async () => {
	const h = raceHarness();
	h.state.pendingEnvelope = null;
	const images = [{ name: 'a.png', mimeType: 'image/png', data: 'aGVsbG8=' }];
	h.state.images = images;
	const sent = h.state.submit({ preventDefault() {} } as SubmitEvent);
	h.state.images = [];
	h.state.images = images;
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await sent;
	expect(h.state.images).toEqual(images);
});

test('authoritative acceptance recovers an unacknowledged queued envelope', async () => {
	const h = raceHarness();
	h.session.delivery = 'running';
	h.session.activeMessageId = 'current';
	const sync = (h.state as unknown as { syncEvents(): Promise<void> }).syncEvents();
	h.response.resolve({
		events: [{ sequence: 1, type: 'message.accepted', payload: { messageId: 'origin-message' } }]
	} as never);
	await sync;
	expect(h.state.pendingEnvelope).toBeNull();
	expect(h.session.queuedMessages).toEqual([expect.objectContaining({ id: 'origin-message' })]);
});

test('exact retry does not clear an unrelated current draft', async () => {
	const h = raceHarness();
	h.state.composer = 'unrelated newer draft';
	const sent = h.state.retryPendingMessage();
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await sent;
	expect(h.state.composer).toBe('unrelated newer draft');
});

test('a terminal event supersedes a delayed send acknowledgement', async () => {
	const h = raceHarness();
	const sent = h.state.sendText('origin message');
	h.session.delivery = 'completed';
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await sent;
	expect(h.session.delivery).toBe('completed');
	expect(h.session.timeline).toEqual([
		expect.objectContaining({ role: 'user', messageId: 'origin-message' })
	]);
});

test('POST acknowledgement does not duplicate the user row recovered by event polling', async () => {
	const h = raceHarness();
	const sent = h.state.sendText('origin message');
	h.session.timeline = [
		{
			kind: 'message',
			role: 'user',
			messageId: 'origin-message',
			text: 'origin message',
			sequence: 1
		}
	] as never;
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await sent;
	expect(h.session.timeline).toHaveLength(1);
});

test('concurrent busy submits retain one uncertain exact envelope', async () => {
	const h = raceHarness();
	h.session.delivery = 'running';
	h.session.activeMessageId = 'current-turn';
	const first = h.state.submit({ preventDefault() {} } as SubmitEvent);
	const second = h.state.submit({ preventDefault() {} } as SubmitEvent);
	h.response.reject(new Error('lost acknowledgement'));
	await Promise.all([first, second]);
	expect(h.requests).toHaveLength(1);
	expect(h.state.pendingEnvelope?.id).toBe('origin-message');
	expect(h.session.activeMessageId).toBe('current-turn');
	expect(stored.get('hue:pending:origin-project:origin-session')).toContain('origin-message');
});

test('new queued send captures its ID before POST and retries that ID after transport loss', async () => {
	const h = raceHarness();
	h.state.pendingEnvelope = null;
	stored.delete('hue:pending:origin-project:origin-session');
	h.session.delivery = 'running';
	h.session.activeMessageId = 'current';
	const sent = h.state.submit({ preventDefault() {} } as SubmitEvent);
	const id = JSON.parse(String(h.requests[0].body)).messageId;
	expect(JSON.parse(stored.get('hue:pending:origin-project:origin-session') ?? 'null')?.id).toBe(
		id
	);
	h.response.reject(new Error('lost acknowledgement'));
	await sent;
	let retriedId = '';
	(
		h.state as unknown as {
			options: { api: (_path: string, init: RequestInit) => Promise<unknown> };
		}
	).options.api = async (_path, init) => {
		retriedId = JSON.parse(String(init.body)).messageId;
		return { duplicate: true, status: 'queued', workMode: 'live' };
	};
	await h.state.retryPendingMessage();
	expect(retriedId).toBe(id);
	expect(h.session.activeMessageId).toBe('current');
	expect(h.session.queuedMessages).toHaveLength(1);
});

test('storage failure cannot strand uncertain delivery', async () => {
	const h = raceHarness();
	const original = localStorage.setItem;
	localStorage.setItem = () => {
		throw new Error('quota');
	};
	try {
		const sent = h.state.sendText('origin message');
		h.response.reject(new Error('lost acknowledgement'));
		expect(await sent).toBe(false);
		expect(h.session.delivery).toBe('delivery unknown');
		expect(h.state.pendingEnvelope?.id).toBe('origin-message');
		expect(h.errors.join(' ')).toContain('lost acknowledgement');
	} finally {
		localStorage.setItem = original;
	}
});

test('stop acknowledgement cannot overwrite terminal event', async () => {
	const h = raceHarness();
	h.session.delivery = 'running';
	const stopped = h.state.stopTurn();
	h.session.delivery = 'completed';
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	await stopped;
	expect(h.session.delivery).toBe('completed');
});

test('a stop request does not lock the newly selected session', async () => {
	const h = raceHarness();
	const first = h.state.stopTurn();
	h.switchSelection();
	expect(h.state.stopping).toBe(false);
	const second = h.state.stopTurn();
	expect(h.requests).toHaveLength(2);
	h.response.resolve({} as never);
	await Promise.all([first, second]);
});

test('a different draft cannot bypass unresolved exact-envelope recovery', async () => {
	const h = raceHarness();
	const sent = h.state.sendText('different message');
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	expect(await sent).toBe(false);
	expect(h.requests).toHaveLength(0);
});

test('queued edit response is scoped to captured selection and message', async () => {
	const h = raceHarness();
	h.state.editingQueuedMessageId = 'queued-a';
	const sent = h.state.submit({ preventDefault() {} } as SubmitEvent);
	h.switchSelection();
	h.state.editingQueuedMessageId = 'queued-b';
	h.session.queuedMessages = [{ id: 'queued-b' }] as never;
	h.response.resolve({ message: { id: 'queued-a' } } as never);
	await sent;
	expect(h.session.queuedMessages).toEqual([{ id: 'queued-b' }]);
});

test('stopping a poll aborts its flight and permits the next selection to poll', async () => {
	const h = raceHarness();
	const sync = () => (h.state as unknown as { syncEvents(): Promise<void> }).syncEvents();
	const first = sync();
	h.state.stopPolling();
	h.switchSelection();
	const second = sync();
	expect(h.requests).toHaveLength(2);
	expect(h.requests[0]?.signal?.aborted).toBe(true);
	h.response.resolve({ events: [] } as never);
	await Promise.all([first, second]);
});

test('successful empty polling restores connectivity without inventing a turn outcome', async () => {
	const h = raceHarness();
	h.session.delivery = 'running';
	const sync = () => (h.state as unknown as { syncEvents(): Promise<void> }).syncEvents();
	h.response.reject(new Error('offline'));
	await sync();
	expect(h.session.delivery).toBe('reconnecting');
	(h.state as unknown as { options: { api: () => Promise<unknown> } }).options.api = async () => ({
		events: []
	});
	await sync();
	expect(h.session.delivery).toBe('running');
});

test('connectivity recovery remains scoped when revisiting a disconnected session', async () => {
	const h = raceHarness();
	h.session.delivery = 'running';
	const sync = () => (h.state as unknown as { syncEvents(): Promise<void> }).syncEvents();
	h.response.reject(new Error('offline'));
	await sync();
	h.switchSelection();
	h.session.delivery = 'running';
	(h.state as unknown as { options: { api: () => Promise<unknown> } }).options.api = async () => ({
		events: []
	});
	await sync();
	h.returnToOrigin();
	await sync();
	expect(h.session.delivery).toBe('running');
});

test('an old poll runtime cannot overwrite a newer model selection', async () => {
	const h = raceHarness();
	h.session.delivery = 'running';
	const session = h.session as unknown as { runtime: { profile: string } };
	session.runtime = { profile: 'before' };
	const sync = (h.state as unknown as { syncEvents(): Promise<void> }).syncEvents();
	session.runtime = { profile: 'new-selection' };
	h.response.resolve({ events: [], runtime: { profile: 'old-poll' } } as never);
	await sync;
	expect(session.runtime.profile).toBe('new-selection');
});

test('file intake blocks send and discards a stale selection result', async () => {
	const h = raceHarness();
	let finish!: () => void;
	Reflect.set(
		globalThis,
		'FileReader',
		class {
			result = 'data:text/plain;base64,aGVsbG8=';
			onload?: () => void;
			readAsDataURL() {
				finish = () => this.onload?.();
			}
		}
	);
	(h.session as unknown as { runtime: unknown }).runtime = { capabilities: { promptImage: true } };
	const reading = h.state.addFiles([{ name: 'notes.txt', type: 'text/plain', size: 5 } as File]);
	const sending = h.state.sendText('origin message');
	h.response.resolve({ duplicate: false, status: 'accepted', workMode: 'live' });
	expect(await sending).toBe(false);
	h.switchSelection();
	finish();
	await reading;
	expect(h.state.attachments).toEqual([]);
});

test('pending reattachment verifies content, not just the file name', async () => {
	const h = raceHarness();
	(h.session as unknown as { runtime: unknown }).runtime = { capabilities: { promptImage: true } };
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello'));
	const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
	h.state.pendingEnvelope!.attachments = [
		{ name: 'notes.txt', mimeType: 'text/plain', size: 5, fingerprint, reattachRequired: true }
	] as never;
	let content = 'wrong';
	Reflect.set(
		globalThis,
		'FileReader',
		class {
			result = '';
			onload?: () => void;
			readAsDataURL() {
				this.result = `data:text/plain;base64,${btoa(content)}`;
				queueMicrotask(() => this.onload?.());
			}
		}
	);
	await h.state.addFiles([{ name: 'notes.txt', type: 'text/plain', size: 5 } as File]);
	expect(h.state.pendingEnvelope!.attachments[0].data).toBeUndefined();
	expect(h.errors.at(-1)).toContain('did not match');
	content = 'hello';
	await h.state.addFiles([{ name: 'notes.txt', type: 'text/plain', size: 5 } as File]);
	expect(h.state.pendingEnvelope!.attachments[0].data).toBe(btoa('hello'));
	expect(h.state.pendingEnvelope!.id).toBe('origin-message');
});

test('queued attachment augmentation retains old metadata and sends only new bytes', async () => {
	const h = raceHarness();
	h.state.editingQueuedMessageId = 'queued';
	h.state.attachments = [
		{ name: 'old.txt', mimeType: 'text/plain', size: 5, reattachRequired: true },
		{ name: 'new.txt', mimeType: 'text/plain', size: 5, data: btoa('hello') }
	];
	const sent = h.state.submit({ preventDefault() {} } as SubmitEvent);
	const body = JSON.parse(String(h.requests[0].body));
	h.response.resolve({ message: { id: 'queued' } } as never);
	await sent;
	expect(body.preserveAttachments).toBe(true);
	expect(body.attachments).toEqual([
		{ name: 'new.txt', mimeType: 'text/plain', size: 5, data: btoa('hello') }
	]);
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

test('unsupported image capability rejects only images and preserves file attachments', async () => {
	class TestFileReader {
		result: string | null = null;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		readAsDataURL(file: File) {
			queueMicrotask(() => {
				this.result = `data:${file.type};base64,${
					file.type === 'image/png'
						? Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
						: Buffer.from('notes').toString('base64')
				}`;
				this.onload?.();
			});
		}
	}
	Reflect.set(globalThis, 'FileReader', TestFileReader);
	const errors: string[] = [];
	const state = new MessageState({
		session: { runtime: { profile: 'default', capabilities: { promptImage: false } } },
		setError: (message: string) => errors.push(message)
	} as never);

	await state.addFiles([
		{ name: 'screen.png', type: 'image/png', size: 8 } as File,
		{ name: 'notes.txt', type: 'text/plain', size: 5 } as File
	]);

	expect(state.images).toEqual([]);
	expect(state.attachments).toEqual([
		expect.objectContaining({ name: 'notes.txt', mimeType: 'text/plain', size: 5 })
	]);
	expect(errors.at(-1)).toBe('Hermes does not support image prompts');
});

test('leaves image count to Hermes', async () => {
	class TestFileReader {
		result: string | null = null;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		readAsDataURL(file: File) {
			queueMicrotask(() => {
				this.result = `data:${file.type};base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
				this.onload?.();
			});
		}
	}
	Reflect.set(globalThis, 'FileReader', TestFileReader);
	const errors: string[] = [];
	const state = new MessageState({
		session: { runtime: { profile: 'default', capabilities: { promptImage: true } } },
		setError: (message: string) => errors.push(message)
	} as never);
	const files = Array.from(
		{ length: 5 },
		(_, index) => ({ name: `${index}.png`, type: 'image/png', size: 8 }) as File
	);

	await state.addFiles(files);

	expect(state.images).toHaveLength(5);
	expect(errors.at(-1)).toBe('');
});

test('improvePrompt returns the result without replacing the editable draft', async () => {
	const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
	const state = new MessageState({
		api: async (path: string, init: RequestInit) => {
			requests.push({ path, body: JSON.parse(String(init.body)) });
			return {
				status: 'completed',
				prompt: 'Build a responsive portfolio for a documentary photographer.',
				questions: [{ id: 'audience', question: 'Who should the portfolio attract?' }],
				sessionId: 'improvement-session',
				messageId: 'operation'
			};
		},
		getProject: () => ({ id: 'hue' }),
		getSession: () => ({ sessionId: 'source' }),
		getNavigation: () => ({
			captureSessionSelection: () => ({ generation: 1, projectId: 'hue', sessionId: 'source' }),
			isCurrentSessionSelection: () => true,
			sessionApiPath: (id: string, suffix = '') => `/api/projects/hue/sessions/${id}${suffix}`
		}),
		setError() {}
	} as never);
	state.composer = 'make photographer site';

	const result = await state.improvePrompt([], 'openai:gpt-5');

	expect(result).toMatchObject({
		status: 'completed',
		prompt: 'Build a responsive portfolio for a documentary photographer.'
	});
	expect(state.composer).toBe('make photographer site');
	expect(requests).toHaveLength(1);
	expect(requests[0].path).toBe('/api/projects/hue/sessions/source/prompt-improvement');
	expect(requests[0].body).toMatchObject({
		text: 'make photographer site',
		answers: [],
		modelId: 'openai:gpt-5'
	});
	expect(requests[0].body.operationId).toBeString();
});
