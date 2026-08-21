import { spawnSync } from 'node:child_process';

export type HermesPanel = 'skills' | 'schedules' | 'profiles';

const clean = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

export function parseSkills(output: string) {
	return clean(output)
		.split('\n')
		.filter((line) => line.trim().startsWith('│'))
		.map((line) => line.split('│').slice(1, -1).map((cell) => cell.trim()))
		.filter((cells) => cells.length === 5 && cells[0] !== 'Name')
		.map(([name, category, source, trust, status]) => ({
			name,
			category,
			source,
			trust,
			status
		}));
}

export function parseCronJobs(output: string) {
	const jobs: Array<Record<string, string>> = [];
	let current: Record<string, string> | null = null;
	for (const line of clean(output).split('\n')) {
		const heading = line.match(/^\s{2}(\S+) \[([^\]]+)\]$/);
		if (heading) {
			current = { id: heading[1], status: heading[2] };
			jobs.push(current);
			continue;
		}
		const field = line.match(/^\s{4}([^:]+):\s+(.*)$/);
		if (!current || !field) continue;
		const key = field[1].trim();
		if (key === 'Name') current.name = field[2];
		if (key === 'Schedule') current.schedule = field[2];
		if (key === 'Next run') current.nextRun = field[2];
		if (key === 'Last run') current.lastRun = field[2];
	}
	return jobs;
}

export function parseProfiles(output: string) {
	return clean(output)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('Profile') && !line.startsWith('─'))
		.map((line) => {
			const active = line.startsWith('◆');
			const [name, model, gateway] = line.replace(/^◆/, '').trim().split(/\s{2,}/);
			return { name, model, gateway, active };
		})
		.filter((profile) => profile.name && profile.model);
}

export function readHermesPanel(panel: HermesPanel) {
	const args =
		panel === 'skills'
			? ['skills', 'list', '--source', 'all']
			: panel === 'schedules'
				? ['cron', 'list', '--all']
				: ['profile', 'list'];
	const result = spawnSync('hermes', args, {
		encoding: 'utf8',
		timeout: 15_000,
		maxBuffer: 10 * 1024 * 1024,
		env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', COLUMNS: '500' }
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr.trim() || `hermes ${args.join(' ')} failed`);
	if (panel === 'skills') return { skills: parseSkills(result.stdout) };
	if (panel === 'schedules') return { jobs: parseCronJobs(result.stdout) };
	return { profiles: parseProfiles(result.stdout) };
}
