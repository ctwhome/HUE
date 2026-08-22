import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedHermesEnvironment } from './hermes-acp';
import { resolveHermesCommand } from './hermes-cli';
import { HermesProjects } from './hermes-projects';
import { HermesServe } from './hermes-serve';

const realHermesTest = process.env.HUE_REAL_HERMES === '1' ? it : it.skip;

realHermesTest(
	'round-trips exact multi-folder Project mutations through installed Hermes serve RPC',
	async () => {
		const home = mkdtempSync(join(tmpdir(), 'hue-real-projects-'));
		const app = join(home, 'app');
		const docs = join(home, 'docs');
		mkdirSync(app);
		mkdirSync(docs);
		const admin = new HermesServe({
			command: resolveHermesCommand(),
			profile: 'default',
			env: isolatedHermesEnvironment(process.env, home)
		});
		const projects = new HermesProjects(
			{ request: (method, params) => admin.rpc(method, params) },
			'default'
		);
		try {
			const created = await projects.create({
				name: 'HUE real RPC',
				folders: [app, docs],
				primaryPath: app
			});
			expect(created.folders.map(({ path }) => path)).toEqual([app, docs]);
			expect(created.primary_path).toBe(app);

			const labeled = await projects.addFolder(created.id, docs, { label: 'Docs' });
			expect(labeled.folders.find(({ path }) => path === docs)?.label).toBe('Docs');
			const primary = await projects.setPrimary(created.id, docs);
			expect(primary.primary_path).toBe(docs);
			const removed = await projects.removeFolder(created.id, app);
			expect(removed.folders.map(({ path }) => path)).toEqual([docs]);

			await projects.archive(created.id);
			expect((await projects.get(created.id)).archived).toBe(true);
		} finally {
			await admin.close();
			rmSync(home, { recursive: true, force: true });
		}
	},
	20_000
);
