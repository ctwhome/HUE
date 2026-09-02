import { beforeEach, expect, mock, test } from 'bun:test';
import { HermesProjectsCapabilityError } from '$lib/server/hermes-projects';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const created = {
	id: 'p_new',
	name: 'Workspace',
	icon: null,
	primary_path: '/work/app',
	folders: [
		{ path: '/work/app', label: null, is_primary: true, added_at: 1 },
		{ path: '/work/docs', label: null, is_primary: false, added_at: 2 }
	],
	archived: false
};
const calls: unknown[] = [];
let listFailure: Error | null = null;

mock.module('$lib/server/route-services', () => ({
	...serviceExportStubs,
	loadProjectViews: async () => {
		if (listFailure) throw listFailure;
		return {
			projects: [
				{
					id: 'p_existing',
					name: 'Existing',
					icon: null,
					color: null,
					group: 'Core',
					primaryPath: '/work/existing',
					folders: [],
					rootAvailable: true
				}
			],
			reconciliationIssues: []
		};
	},
	projectView: (
		project: typeof created,
		color: string | null = null,
		group: string | null = null
	) => ({
		id: project.id,
		name: project.name,
		icon: project.icon,
		color,
		group,
		primaryPath: project.primary_path,
		folders: project.folders,
		rootAvailable: true
	}),
	trustedProjectRoot: (path: string) => {
		if (!path.startsWith('/work/')) throw new Error('Project root is outside boundary');
		return path;
	},
	services: () => ({
		projects: {
			create: async (input: unknown) => {
				calls.push(input);
				return created;
			}
		},
		store: {
			ensureProjectMetadata: (id: string) => calls.push({ ensureMetadata: id }),
			updateProjectColor: (id: string, color: string) => calls.push({ updateColor: [id, color] }),
			updateProjectGroup: (id: string, group: string) => calls.push({ updateGroup: [id, group] })
		}
	})
}));

beforeEach(() => {
	calls.length = 0;
	listFailure = null;
});

test('GET renders authoritative Hermes Projects plus reconciliation status', async () => {
	const { GET } = await import('./+server');
	const response = await GET({} as never);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		projects: [expect.objectContaining({ id: 'p_existing', primaryPath: '/work/existing' })],
		projectsCapability: 'available',
		reconciliationIssues: []
	});
});

test('POST creates exactly one Hermes Project with all validated folders and selected primary', async () => {
	const { POST } = await import('./+server');
	const response = await POST({
		request: new Request('http://localhost/api/projects', {
			method: 'POST',
			body: JSON.stringify({
				name: 'Workspace',
				icon: '📚',
				color: '#7aa2f7',
				group: 'Writing',
				folders: ['/work/app', '/work/docs'],
				primaryPath: '/work/app'
			})
		})
	} as never);

	expect(response.status).toBe(201);
	expect(calls).toEqual([
		{
			name: 'Workspace',
			icon: '📚',
			folders: ['/work/app', '/work/docs'],
			primaryPath: '/work/app'
		},
		{ ensureMetadata: 'p_new' },
		{ updateColor: ['p_new', '#7aa2f7'] },
		{ updateGroup: ['p_new', 'Writing'] }
	]);
	expect((await response.json()).project).toMatchObject({
		id: 'p_new',
		color: '#7aa2f7',
		group: 'Writing',
		primaryPath: '/work/app'
	});
});

test('POST rejects duplicate folders or primary outside selection before Hermes mutation', async () => {
	const { POST } = await import('./+server');
	for (const body of [
		{ name: 'Duplicate', folders: ['/work/app', '/work/app'], primaryPath: '/work/app' },
		{ name: 'Missing primary', folders: ['/work/app'], primaryPath: '/work/docs' }
	]) {
		const response = await POST({
			request: new Request('http://localhost/api/projects', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		} as never);
		expect(response.status).toBe(400);
	}
	expect(calls).toEqual([]);
});

test('GET capability-gates old Hermes without falling back to HUE rows', async () => {
	listFailure = new HermesProjectsCapabilityError();
	const { GET } = await import('./+server');
	const response = await GET({} as never);

	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({
		error: expect.stringContaining('Upgrade Hermes'),
		projects: [],
		projectsCapability: 'unavailable'
	});
});
