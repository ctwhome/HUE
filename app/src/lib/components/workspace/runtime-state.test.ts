import { expect, test } from 'bun:test';
Reflect.set(globalThis, '$state', <T>(value: T) => value);
const { RuntimeState } = await import('./runtime-state.svelte');

test('runtime completion cannot merge into another selection', async () => {
	let generation = 1;
	let resolve!: (value: unknown) => void;
	const session = { runtime: { profile: 'destination' } };
	const state = new RuntimeState({
		api: () =>
			new Promise((done) => {
				resolve = done;
			}),
		getSession: () => ({ sessionId: 'same-id' }),
		captureSelection: () => generation,
		isCurrentSelection: (value: number) => value === generation,
		sessionPath: () => '/session',
		session,
		setError() {},
		rememberSelection() {}
	} as never);
	const changing = state.change('modelId', 'old-model');
	generation++;
	resolve({ runtime: { profile: 'origin' } });
	await changing;
	expect(session.runtime.profile).toBe('destination');
});

test('a pending runtime change does not lock another selection', async () => {
	let generation = 1;
	const resolvers: Array<(value: unknown) => void> = [];
	const state = new RuntimeState({
		api: () => new Promise((done) => resolvers.push(done)),
		getSession: () => ({ sessionId: String(generation) }),
		captureSelection: () => generation,
		isCurrentSelection: (value: number) => value === generation,
		sessionPath: () => '/session',
		session: { runtime: {} },
		setError() {},
		rememberSelection() {}
	} as never);
	const first = state.change('modelId', 'a');
	generation++;
	expect(state.changing).toBe(false);
	const second = state.change('modelId', 'b');
	expect(resolvers).toHaveLength(2);
	resolvers[0]({ runtime: {} });
	await first;
	expect(state.changing).toBe(true);
	resolvers[1]({ runtime: {} });
	await second;
	expect(state.changing).toBe(false);
});
