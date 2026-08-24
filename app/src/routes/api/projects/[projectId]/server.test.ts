import { beforeEach, expect, mock, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serviceExportStubs } from '$lib/server/services-test-stubs';
import { HermesProjectMutationError } from '$lib/server/hermes-projects';

const original = {
	id: 'p_1',
	name: 'Original',
	icon: null,
	primary_path: '/work/old',
	folders: [
		{ path: '/work/old', label: null, is_primary: true, added_at: 1 },
		{ path: '/work/docs', label: 'Docs', is_primary: false, added_at: 2 }
	],
	archived: false
};
const readback = { ...original, name: 'Renamed', icon: '🚀' };
const calls: Array<{ method: string; args: unknown[] }> = [];
const closedProjects: string[] = [];
let activeDelivery = false;
let removeFailure: Error | null = null;
const activeChecks: string[] = [];
const colorUpdates: Array<{ id: string; color: string }> = [];
let projectRoot = '/work/old';

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	projectView: (project: typeof original) => ({
		id: project.id,
		name: project.name,
		icon: project.icon,
		primaryPath: project.primary_path,
		folders: project.folders,
		rootAvailable: true
	}),
	trustedProjectRoot: (rootPath: string) => {
		if (!rootPath.startsWith('/work/')) throw new Error('Project root is outside boundary');
		return rootPath;
	},
	services: () => {
		const projects = {
			get: async (id: string) => {
				calls.push({ method: 'get', args: [id] });
				return { ...original, primary_path: projectRoot };
			},
			update: async (...args: unknown[]) => {
				calls.push({ method: 'update', args });
				return readback;
			},
			addFolder: async (...args: unknown[]) => {
				calls.push({ method: 'addFolder', args });
				return readback;
			},
			removeFolder: async (...args: unknown[]) => {
				calls.push({ method: 'removeFolder', args });
				if (removeFailure) throw removeFailure;
				return readback;
			},
			setPrimary: async (...args: unknown[]) => {
				calls.push({ method: 'setPrimary', args });
				return { ...readback, primary_path: '/work/docs' };
			},
			archive: async (...args: unknown[]) => {
				calls.push({ method: 'archive', args });
				return { ...original, archived: true };
			}
		};
		return {
			projects: {
				...projects
			},
			store: {
				ensureProjectMetadata: () => undefined,
				getProjectColor: () => colorUpdates.at(-1)?.color ?? null,
				updateProjectColor: (id: string, color: string) => colorUpdates.push({ id, color }),
				hasActiveProjectDeliveries: () => activeDelivery,
				deleteProject: () => {
					throw new Error('HUE Project metadata must not be deleted');
				}
			},
			terminals: { closeProject: (projectId: string) => closedProjects.push(projectId) },
			projectOperations: {
				archive: async (reference: string) => {
					const project = await projects.get(reference);
					activeChecks.push(project.id);
					if (activeDelivery) throw new Error('Project has active message deliveries');
					return projects.archive(project.id);
				}
			}
		};
	}
}));

beforeEach(() => {
	calls.length = 0;
	closedProjects.length = 0;
	activeDelivery = false;
	removeFailure = null;
	activeChecks.length = 0;
	colorUpdates.length = 0;
	projectRoot = '/work/old';
});

async function patch(body: unknown, projectId = 'p_1') {
	const { PATCH } = await import('./+server');
	return PATCH({
		params: { projectId },
		request: new Request('http://localhost/api/projects/p_1', {
			method: 'PATCH',
			body: JSON.stringify(body)
		})
	} as never);
}

test('updates Hermes name and icon and returns authoritative readback', async () => {
	const response = await patch({ action: 'update', name: 'Renamed', icon: '🚀' });

	expect(response.status).toBe(200);
	expect(calls).toEqual([{ method: 'update', args: ['p_1', { name: 'Renamed', icon: '🚀' }] }]);
	expect((await response.json()).project).toMatchObject({ id: 'p_1', name: 'Renamed' });
});

test('updates HUE status color without mutating Hermes Project identity', async () => {
	const response = await patch({ action: 'set_color', color: '#7aa2f7' });

	expect(response.status).toBe(200);
	expect(colorUpdates).toEqual([{ id: 'p_1', color: '#7aa2f7' }]);
	expect(calls).toEqual([{ method: 'get', args: ['p_1'] }]);
});

test('rejects malformed Project status colors', async () => {
	const response = await patch({ action: 'set_color', color: 'red' });

	expect(response.status).toBe(400);
	expect(colorUpdates).toEqual([]);
});

test('automatic icon discovers a favicon within the Project', async () => {
	projectRoot = mkdtempSync(join(tmpdir(), 'hue-project-icon-'));
	mkdirSync(join(projectRoot, 'public'));
	writeFileSync(join(projectRoot, 'public', 'favicon.ico'), Buffer.from([0, 0, 1, 0]));

	const response = await patch({ action: 'auto_icon' });

	expect(response.status).toBe(200);
	expect(calls).toEqual([
		{ method: 'get', args: ['p_1'] },
		{
			method: 'update',
			args: ['p_1', { icon: 'data:image/x-icon;base64,AAABAA==' }]
		}
	]);
});

test('adds a validated backend folder with label and primary choice', async () => {
	const response = await patch({
		action: 'add_folder',
		path: '/work/docs',
		label: 'Documentation',
		isPrimary: true
	});

	expect(response.status).toBe(200);
	expect(calls).toEqual([
		{
			method: 'addFolder',
			args: ['p_1', '/work/docs', { label: 'Documentation', isPrimary: true }]
		}
	]);
	expect(closedProjects).toEqual(['p_1']);
});

test('removes a folder only through Hermes with explicit replacement readback', async () => {
	const response = await patch({
		action: 'remove_folder',
		path: '/work/old',
		replacementPrimary: '/work/docs'
	});

	expect(response.status).toBe(200);
	expect(calls).toEqual([{ method: 'removeFolder', args: ['p_1', '/work/old', '/work/docs'] }]);
	expect(closedProjects).toEqual(['p_1']);
});

test('returns compensation readback and reconciliation state from partial primary removal', async () => {
	const partial = {
		...original,
		primary_path: '/work/docs',
		folders: original.folders.map((folder) => ({
			...folder,
			is_primary: folder.path === '/work/docs'
		}))
	};
	removeFailure = new HermesProjectMutationError(
		'remove failed; primary restoration failed; reconciliation required',
		partial,
		false,
		true
	);

	const response = await patch({
		action: 'remove_folder',
		path: '/work/old',
		replacementPrimary: '/work/docs'
	});
	const body = await response.json();

	expect(response.status).toBe(400);
	expect(body.project.primaryPath).toBe('/work/docs');
	expect(body).toMatchObject({ restored: false, reconciliationRequired: true });
	expect(closedProjects).toEqual(['p_1']);
});

test('sets primary only to a validated backend folder', async () => {
	const response = await patch({ action: 'set_primary', path: '/work/docs' });

	expect(response.status).toBe(200);
	expect(calls).toEqual([{ method: 'setPrimary', args: ['p_1', '/work/docs'] }]);
	expect(closedProjects).toEqual(['p_1']);
});

test('closes terminals by authoritative mutation readback id when route uses slug', async () => {
	for (const body of [
		{ action: 'add_folder', path: '/work/docs', isPrimary: true },
		{ action: 'remove_folder', path: '/work/old', replacementPrimary: '/work/docs' },
		{ action: 'set_primary', path: '/work/docs' }
	]) {
		calls.length = 0;
		closedProjects.length = 0;
		const response = await patch(body, 'project-slug');
		expect(response.status).toBe(200);
		expect(closedProjects).toEqual(['p_1']);
	}
});

test('rejects malformed folder mutation before Hermes call', async () => {
	const response = await patch({ action: 'add_folder', path: '../secret', isPrimary: false });

	expect(response.status).toBe(400);
	expect(calls).toEqual([]);
});

test('archives Hermes Project without deleting HUE-owned foreign-key metadata', async () => {
	const { DELETE } = await import('./+server');
	const response = await DELETE({ params: { projectId: 'p_1' } } as never);

	expect(response.status).toBe(200);
	expect(calls).toEqual([
		{ method: 'get', args: ['p_1'] },
		{ method: 'archive', args: ['p_1'] }
	]);
	expect(activeChecks).toEqual(['p_1']);
	expect(closedProjects).toEqual(['p_1']);
});

test('DELETE by slug checks queued, running, and unknown deliveries under canonical Hermes id', async () => {
	const { DELETE } = await import('./+server');
	for (const status of ['queued', 'running', 'unknown']) {
		calls.length = 0;
		activeChecks.length = 0;
		activeDelivery = true;
		const response = await DELETE({ params: { projectId: `slug-${status}` } } as never);

		expect(response.status).toBe(409);
		expect(calls).toEqual([{ method: 'get', args: [`slug-${status}`] }]);
		expect(activeChecks).toEqual(['p_1']);
		expect(closedProjects).toEqual([]);
	}
});

test('refuses archive while HUE owns unresolved delivery state', async () => {
	activeDelivery = true;
	const { DELETE } = await import('./+server');
	const response = await DELETE({ params: { projectId: 'p_1' } } as never);

	expect(response.status).toBe(409);
	expect(calls.some(({ method }) => method === 'archive')).toBe(false);
});
