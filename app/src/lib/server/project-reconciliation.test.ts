import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HermesProject } from './hermes-projects';
import { reconcileLegacyProjects } from './project-reconciliation';
import { HUEStore } from './store';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function folderProject(id: string, path: string): HermesProject {
	return {
		id,
		name: id,
		icon: null,
		primary_path: path,
		folders: [{ path, label: null, is_primary: true, added_at: 1 }],
		archived: false
	};
}

function client(initial: HermesProject[]) {
	const creates: unknown[] = [];
	return {
		creates,
		list: async () => ({ projects: initial, activeId: null }),
		create: async (input: {
			name: string;
			icon?: string | null;
			folders: string[];
			primaryPath: string;
		}) => {
			creates.push(input);
			return folderProject('p_created', input.primaryPath);
		}
	};
}

describe('legacy HUE Project reconciliation', () => {
	it('adopts one Hermes Project by canonical folder membership', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-real-'));
		const alias = `${root}-alias`;
		symlinkSync(root, alias);
		temporaryDirectories.push(alias, root);
		const store = new HUEStore(':memory:');
		store.createProject({ id: 'legacy', name: 'Legacy', rootPath: alias });
		store.createWorkflow({ id: 'workflow', projectId: 'legacy', name: 'Keep', prompt: 'Keep me' });
		const hermes = client([folderProject('p_existing', root)]);

		const result = await reconcileLegacyProjects(store, hermes);

		expect(result.issues).toEqual([]);
		expect(hermes.creates).toEqual([]);
		expect(store.listLegacyProjects()).toEqual([]);
		expect(store.listWorkflows('p_existing').map(({ id }) => id)).toEqual(['workflow']);
		store.close();
	});

	it('reports ambiguous canonical matches without changing HUE ownership', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-ambiguous-'));
		temporaryDirectories.push(root);
		const store = new HUEStore(':memory:');
		store.createProject({ id: 'legacy', name: 'Legacy', rootPath: root });
		const hermes = client([folderProject('p_one', root), folderProject('p_two', root)]);

		const result = await reconcileLegacyProjects(store, hermes);

		expect(result.issues).toEqual([
			expect.objectContaining({
				legacyProjectId: 'legacy',
				kind: 'ambiguous',
				message: expect.stringContaining('p_one, p_two')
			})
		]);
		expect(hermes.creates).toEqual([]);
		expect(store.listLegacyProjects().map(({ id }) => id)).toEqual(['legacy']);
		store.close();
	});

	it('never merges two legacy HUE Projects into one matching Hermes Project', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-collision-'));
		const alias = `${root}-alias`;
		symlinkSync(root, alias);
		temporaryDirectories.push(alias, root);
		const store = new HUEStore(':memory:');
		store.createProject({ id: 'legacy-one', name: 'One', rootPath: root });
		store.createProject({ id: 'legacy-two', name: 'Two', rootPath: alias });
		store.createWorkflow({ id: 'one', projectId: 'legacy-one', name: 'One', prompt: 'One' });
		store.createWorkflow({ id: 'two', projectId: 'legacy-two', name: 'Two', prompt: 'Two' });
		const hermes = client([folderProject('p_existing', root)]);

		const result = await reconcileLegacyProjects(store, hermes);

		expect(result.issues.map(({ legacyProjectId, kind }) => ({ legacyProjectId, kind }))).toEqual([
			{ legacyProjectId: 'legacy-one', kind: 'ambiguous' },
			{ legacyProjectId: 'legacy-two', kind: 'ambiguous' }
		]);
		expect(store.listLegacyProjects().map(({ id }) => id)).toEqual(['legacy-one', 'legacy-two']);
		expect(store.listWorkflows('legacy-one').map(({ id }) => id)).toEqual(['one']);
		expect(store.listWorkflows('legacy-two').map(({ id }) => id)).toEqual(['two']);
		store.close();
	});

	it('creates one Hermes Project when no canonical match exists and adopts its id', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-create-'));
		temporaryDirectories.push(root);
		const store = new HUEStore(':memory:');
		store.createProject({ id: 'legacy', name: 'Legacy', rootPath: root });
		store.upsertSession('legacy', { sessionId: 'session', cwd: root });
		const hermes = client([]);

		const result = await reconcileLegacyProjects(store, hermes);
		const canonicalRoot = realpathSync(root);

		expect(result.issues).toEqual([]);
		expect(hermes.creates).toEqual([
			{ name: 'Legacy', icon: null, folders: [canonicalRoot], primaryPath: canonicalRoot }
		]);
		expect(result.projects.map(({ id }) => id)).toEqual(['p_created']);
		expect(store.getSession('p_created', 'session')?.cwd).toBe(root);
		expect(store.listLegacyProjects()).toEqual([]);
		store.close();
	});
});
