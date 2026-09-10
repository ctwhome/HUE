import { expect, mock, test } from 'bun:test';
import type { Project, Workflow } from './types';

Object.assign(globalThis, { $state: <T>(value?: T) => value });
mock.module('$app/navigation', () => ({ pushState() {}, replaceState() {} }));
mock.module('$app/state', () => ({ page: { state: {} } }));
const { WorkspaceNavigation } = await import('./navigation.svelte');

test('Workflow create locks submission, retains newer typing, and updates only its origin cache', async () => {
	let resolve!: (value: { workflow: Workflow }) => void;
	let calls = 0;
	const one = { id: 'one', rootAvailable: true } as Project;
	const state = new WorkspaceNavigation(one, {
		api: () => {
			calls++;
			return new Promise((done) => {
				resolve = done;
			});
		},
		setError() {}
	} as never);
	state.workflowName = 'A';
	state.workflowPrompt = 'A prompt';
	const event = { preventDefault() {} } as SubmitEvent;
	const saving = state.addWorkflow(event);
	void state.addWorkflow(event);
	expect(calls).toBe(1);
	state.workflowName = 'B';
	state.selectedProject = { id: 'two' } as Project;
	state.workflows = [];
	resolve({ workflow: { id: 'created', name: 'A' } as Workflow });
	await saving;
	expect(state.workflows).toEqual([]);
	expect(state.workflowName).toBe('B');
	expect(state.workflowSaving).toBe(false);
	expect((state as any).workflowLists.get('one')[0].id).toBe('created');
});

test('Workflow failures expose actionable local error and release the lock', async () => {
	const state = new WorkspaceNavigation(
		{ id: 'one', rootAvailable: true } as Project,
		{
			api: async () => {
				throw new Error('Workflow unavailable');
			},
			setError() {}
		} as never
	);
	state.workflowName = 'Retained';
	expect(await state.addWorkflow({ preventDefault() {} } as SubmitEvent)).toBe(false);
	expect(state.workflowError).toBe('Workflow unavailable');
	expect(state.workflowName).toBe('Retained');
	expect(state.workflowSaving).toBe(false);
});

for (const action of ['update', 'archive', 'duplicate', 'favorite'] as const) {
	test(`Workflow ${action} locks repeats and reconciles only its origin list`, async () => {
		let resolve!: (value: { workflow: Workflow }) => void;
		let calls = 0;
		const state = new WorkspaceNavigation(
			{ id: 'one', rootAvailable: true } as Project,
			{
				api: () => {
					calls++;
					return new Promise((done) => {
						resolve = done;
					});
				},
				setError() {}
			} as never
		);
		const original = { id: 'original', name: 'Original', prompt: 'Original' } as Workflow;
		state.workflows = [original];
		const mutate = () =>
			action === 'update' || action === 'archive'
				? state.updateWorkflow(
						original,
						action === 'archive' ? { archived: true } : { name: 'Updated' }
					)
				: action === 'duplicate'
					? state.duplicateWorkflow(original)
					: state.favoriteCatalogPrompt({ title: 'Catalog', prompt: 'Catalog' } as never);
		const saving = mutate();
		expect(await mutate()).toBe(false);
		expect(calls).toBe(1);
		state.selectedProject = { id: 'two' } as Project;
		state.workflows = [];
		const updated = {
			...original,
			id: action === 'duplicate' || action === 'favorite' ? 'new' : original.id,
			name: 'Updated',
			archived: action === 'archive'
		};
		resolve({ workflow: updated });
		expect(await saving).toBe(true);
		expect(state.workflows).toEqual([]);
		expect((state as any).workflowLists.get('one')).toContainEqual(updated);
		expect((state as any).workflowLists.get('one')).toHaveLength(
			action === 'duplicate' || action === 'favorite' ? 2 : 1
		);
		expect(state.workflowSaving).toBe(false);
	});
}
