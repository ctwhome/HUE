import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('restores primary panes once with the current Session metadata and clears it on Project changes', () => {
	const source = readFileSync(new URL('./SessionPaneGrid.svelte', import.meta.url), 'utf8')
		.split('<script lang="ts">')[1]!
		.split('</script>')[0]!
		.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
	const effects: Array<() => void> = [];
	const restored: unknown[] = [];
	const current = {
		sessionId: 'primary',
		title: 'Updated',
		cwd: '/work',
		harness: 'opencode',
		workMode: 'live'
	};
	const storage = new Map([
		[
			'hue:session-panes:one',
			JSON.stringify({
				primary: { sessionId: 'primary', title: 'Old', cwd: '/work' },
				sessions: [{ sessionId: 'docked', cwd: '/work' }]
			})
		]
	]);
	const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${source}
		return { complete() { sessionListLoaded = true; }, switchProject() { projectId = 'two'; },
			dock() { setDockedSessions([{ sessionId: 'primary', cwd: '/work' }]); }, closePrimary, dropSession,
		get primary() { return restoredPrimary; }, get docked() { return dockedSessions; } };`);
	const env = {
		$state: (value: unknown) => value,
		$derived: (value: unknown) => value,
		$props: () => ({
			sessions: [current],
			projectId: 'one',
			sessionListLoaded: false,
			primarySession: null,
			onprimaryclose: (session: unknown) => restored.push(session)
		}),
		$effect: (effect: () => void) => effects.push(effect),
		untrack: (fn: () => unknown) => fn(),
		queueMicrotask() {},
		localStorage: {
			getItem: (key: string) => storage.get(key),
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key)
		}
	};
	const state = new Function(...Object.keys(env), code)(...Object.values(env));
	for (const effect of effects) effect();
	expect(state.docked).toHaveLength(1);
	expect(restored).toEqual([]);
	state.complete();
	for (const effect of effects) effect();
	expect(restored).toEqual([current]);
	expect(state.docked).toHaveLength(0);
	state.dock();
	state.closePrimary();
	state.dropSession({ preventDefault() {}, dataTransfer: { getData: () => 'primary' } });
	expect(restored).toEqual([current, current, current]);
	state.switchProject();
	effects[0]();
	expect(state.primary).toBeNull();
});
