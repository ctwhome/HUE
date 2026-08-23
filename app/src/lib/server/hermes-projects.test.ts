import { describe, expect, it } from 'bun:test';
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesProjects, HermesProjectsCapabilityError } from './hermes-projects';
import { HermesProjectsRpcError } from './hermes-projects-rpc';

const project = {
	id: 'p_123',
	name: 'HUE',
	icon: '🟣',
	primary_path: '/work/hue',
	folders: [
		{ path: '/work/hue', label: 'App', is_primary: true, added_at: 1 },
		{ path: '/work/docs', label: null, is_primary: false, added_at: 2 }
	],
	archived: false
};

function transport(respond: (method: string, params: Record<string, unknown>) => unknown) {
	const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	return {
		calls,
		request: async <T>(method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return respond(method, params) as T;
		}
	};
}

describe('HermesProjects', () => {
	it('lists authoritative ordered multi-folder projects for one profile', async () => {
		const rpc = transport(() => ({ projects: [project], active_id: project.id }));
		const projects = new HermesProjects(rpc, 'coder');

		expect(await projects.list()).toEqual({ projects: [project], activeId: project.id });
		expect(rpc.calls).toEqual([{ method: 'projects.list', params: { profile: 'coder' } }]);
	});

	it('creates exactly once with all folders and primary, then renders projects.get readback', async () => {
		const rpc = transport((method) =>
			method === 'projects.create' ? { project: { id: project.id } } : { project }
		);
		const projects = new HermesProjects(rpc, 'default');

		expect(
			await projects.create({
				name: 'HUE',
				icon: '🟣',
				folders: ['/work/hue', '/work/docs'],
				primaryPath: '/work/hue'
			})
		).toEqual(project);
		expect(rpc.calls).toEqual([
			{
				method: 'projects.create',
				params: {
					profile: 'default',
					name: 'HUE',
					icon: '🟣',
					folders: ['/work/hue', '/work/docs'],
					primary_path: '/work/hue'
				}
			},
			{ method: 'projects.get', params: { profile: 'default', id: project.id } }
		]);
	});

	it('rejects create when primary is absent from folders before RPC', async () => {
		const rpc = transport(() => ({}));
		const projects = new HermesProjects(rpc, 'default');

		await expect(
			projects.create({ name: 'Broken', folders: ['/work/hue'], primaryPath: '/work/other' })
		).rejects.toThrow('Primary folder must be one selected folder');
		expect(rpc.calls).toEqual([]);
	});

	it('rejects create folders that resolve to one canonical path before RPC', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-create-'));
		const canonical = join(root, 'canonical');
		const alias = join(root, 'alias');
		await Bun.write(join(canonical, '.keep'), '');
		symlinkSync(canonical, alias);
		const rpc = transport(() => ({}));

		await expect(
			new HermesProjects(rpc, 'default').create({
				name: 'Duplicate',
				folders: [canonical, alias],
				primaryPath: canonical
			})
		).rejects.toThrow('Project folders must be canonically unique');
		expect(rpc.calls).toEqual([]);
	});

	it('adds, relabels, and sets primary with mutation followed by authoritative readback', async () => {
		const rpc = transport((method) => (method === 'projects.get' ? { project } : { project }));
		const projects = new HermesProjects(rpc, 'default');

		await projects.addFolder(project.id, '/work/docs', { label: 'Docs', isPrimary: true });

		expect(rpc.calls).toEqual([
			{ method: 'projects.get', params: { profile: 'default', id: project.id } },
			{
				method: 'projects.add_folder',
				params: {
					profile: 'default',
					id: project.id,
					path: '/work/docs',
					label: 'Docs',
					is_primary: true
				}
			},
			{ method: 'projects.get', params: { profile: 'default', id: project.id } }
		]);
	});

	it('requires explicit valid replacement before removing primary and preserves one folder', async () => {
		const rpc = transport(() => ({ project }));
		const projects = new HermesProjects(rpc, 'default');

		await expect(projects.removeFolder(project.id, '/work/hue')).rejects.toThrow(
			'Replacement primary folder is required'
		);
		await expect(projects.removeFolder(project.id, '/work/hue', '/work/missing')).rejects.toThrow(
			'Replacement primary folder must belong to Project'
		);
		expect(rpc.calls).toEqual([
			{ method: 'projects.get', params: { profile: 'default', id: project.id } },
			{ method: 'projects.get', params: { profile: 'default', id: project.id } }
		]);
	});

	it('sets replacement primary, verifies it, removes old folder, then reads back', async () => {
		let current = project;
		const rpc = transport((method, params) => {
			if (method === 'projects.set_primary') {
				current = {
					...current,
					primary_path: String(params.path),
					folders: current.folders.map((folder) => ({
						...folder,
						is_primary: folder.path === params.path
					}))
				};
			}
			if (method === 'projects.remove_folder') {
				current = {
					...current,
					folders: current.folders.filter(({ path }) => path !== params.path)
				};
			}
			return { project: current };
		});
		const projects = new HermesProjects(rpc, 'default');

		const readback = await projects.removeFolder(project.id, '/work/hue', '/work/docs');

		expect(readback.primary_path).toBe('/work/docs');
		expect(readback.folders.map(({ path }) => path)).toEqual(['/work/docs']);
		expect(rpc.calls.map(({ method }) => method)).toEqual([
			'projects.get',
			'projects.set_primary',
			'projects.get',
			'projects.remove_folder',
			'projects.get'
		]);
	});

	it('restores original primary when primary-folder removal fails', async () => {
		let current = project;
		const rpc = transport((method, params) => {
			if (method === 'projects.set_primary') {
				current = {
					...current,
					primary_path: String(params.path),
					folders: current.folders.map((folder) => ({
						...folder,
						is_primary: folder.path === params.path
					}))
				};
			}
			if (method === 'projects.remove_folder') throw new Error('remove failed');
			return { project: current };
		});

		await expect(
			new HermesProjects(rpc, 'default').removeFolder(project.id, '/work/hue', '/work/docs')
		).rejects.toMatchObject({ message: 'remove failed', project });
		expect(current.primary_path).toBe('/work/hue');
		expect(rpc.calls.map(({ method }) => method)).toEqual([
			'projects.get',
			'projects.set_primary',
			'projects.get',
			'projects.remove_folder',
			'projects.set_primary',
			'projects.get'
		]);
	});

	it('surfaces authoritative partial state when primary compensation fails', async () => {
		let current = project;
		let primaryWrites = 0;
		const rpc = transport((method, params) => {
			if (method === 'projects.set_primary') {
				primaryWrites += 1;
				if (primaryWrites === 2) throw new Error('restore failed');
				current = {
					...current,
					primary_path: String(params.path),
					folders: current.folders.map((folder) => ({
						...folder,
						is_primary: folder.path === params.path
					}))
				};
			}
			if (method === 'projects.remove_folder') throw new Error('remove failed');
			return { project: current };
		});

		await expect(
			new HermesProjects(rpc, 'default').removeFolder(project.id, '/work/hue', '/work/docs')
		).rejects.toMatchObject({
			message: expect.stringContaining('reconciliation required'),
			project: expect.objectContaining({ primary_path: '/work/docs' }),
			reconciliationRequired: true
		});
	});

	it('uses canonical membership while preserving Hermes raw folder identity', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-folders-'));
		const canonical = join(root, 'canonical');
		const alias = join(root, 'alias');
		await Bun.write(join(canonical, '.keep'), '');
		symlinkSync(canonical, alias);
		const rawProject = {
			...project,
			primary_path: alias,
			folders: [
				{ path: alias, label: 'App', is_primary: true, added_at: 1 },
				{ path: '/work/docs', label: null, is_primary: false, added_at: 2 }
			]
		};
		let current = rawProject;
		const rpc = transport((method, params) => {
			if (method === 'projects.set_primary') {
				current = {
					...current,
					primary_path: String(params.path),
					folders: current.folders.map((folder) => ({
						...folder,
						is_primary: folder.path === params.path
					}))
				};
			}
			if (method === 'projects.remove_folder') {
				current = {
					...current,
					folders: current.folders.filter((folder) => folder.path !== params.path)
				};
			}
			return { project: current };
		});
		const projects = new HermesProjects(rpc, 'default');

		await expect(projects.addFolder(project.id, realpathSync(canonical))).rejects.toThrow(
			'Folder already belongs to Project'
		);
		await projects.setPrimary(project.id, realpathSync(canonical));
		await projects.removeFolder(project.id, realpathSync(canonical), '/work/docs');

		const mutations = rpc.calls.filter(({ method }) => method !== 'projects.get');
		expect(mutations[0]?.params.path).toBe(alias);
		expect(mutations.at(-1)?.params.path).toBe(alias);
	});

	it('rejects two Hermes raw folders resolving to one canonical path', async () => {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-duplicate-'));
		const canonical = join(root, 'canonical');
		const alias = join(root, 'alias');
		await Bun.write(join(canonical, '.keep'), '');
		symlinkSync(canonical, alias);
		const duplicate = {
			...project,
			primary_path: canonical,
			folders: [
				{ path: canonical, label: null, is_primary: true, added_at: 1 },
				{ path: alias, label: null, is_primary: false, added_at: 2 }
			]
		};

		await expect(
			new HermesProjects(
				transport(() => ({ project: duplicate })),
				'default'
			).get(project.id)
		).rejects.toThrow('duplicate canonical Project folder');
	});

	it('capability-gates old Hermes runtimes with upgrade recovery guidance', async () => {
		const rpc = transport(() => {
			throw new HermesProjectsRpcError('unknown method: projects.list', -32601);
		});

		await expect(new HermesProjects(rpc, 'default').list()).rejects.toMatchObject({
			capabilityMissing: true,
			message: expect.stringContaining('Upgrade Hermes')
		});
	});

	it('capability-gates direct mutations on old Hermes runtimes', async () => {
		const rpc = transport(() => {
			throw new HermesProjectsRpcError('unknown method: projects.update', -32601);
		});

		await expect(
			new HermesProjects(rpc, 'default').update(project.id, { name: 'New' })
		).rejects.toBeInstanceOf(HermesProjectsCapabilityError);
	});
});
