import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { requestOriginMatches } from './same-origin';

export type DevServer = {
	port: number;
	url: string;
	pid: number;
	process: string;
	folder: string;
	canStop: boolean;
};

export function parseDevServers(
	listeners: string,
	workingDirectories: string,
	protectedPid = process.pid,
	home = homedir()
): DevServer[] {
	const folders = new Map<number, string>();
	let pid = 0;
	for (const line of workingDirectories.split('\n')) {
		if (line.startsWith('p')) pid = Number(line.slice(1));
		if (pid && line.startsWith('n')) folders.set(pid, line.slice(1));
	}

	const servers = new Map<string, DevServer>();
	let processName = '';
	pid = 0;
	for (const line of listeners.split('\n')) {
		if (line.startsWith('p')) {
			pid = Number(line.slice(1));
			processName = '';
			continue;
		}
		if (line.startsWith('c')) {
			processName = line.slice(1);
			continue;
		}
		const match = line.match(/^n.*:(\d+)$/);
		if (!pid || !match) continue;
		const port = Number(match[1]);
		if (!Number.isInteger(port) || port < 1 || port > 65_535) continue;
		const cwd = folders.get(pid);
		servers.set(`${pid}:${port}`, {
			port,
			url: `http://localhost:${port}`,
			pid,
			process: processName || 'Unknown process',
			folder: cwd ? (cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd) : 'Unknown folder',
			canStop: pid !== protectedPid
		});
	}
	return [...servers.values()]
		.sort((left, right) => left.port - right.port || left.pid - right.pid)
		.slice(0, 200)
}

export function discoverDevServers(): DevServer[] {
	const uid = process.getuid?.();
	if (uid === undefined) return [];
	const listeners = spawnSync(
		'lsof',
		['-nP', '+c', '80', `-u${uid}`, '-a', '-iTCP', '-sTCP:LISTEN', '-Fpcn'],
		{
			encoding: 'utf8',
			timeout: 1_500,
			maxBuffer: 1_000_000
		}
	);
	if (listeners.error) return [];
	const pids = [...listeners.stdout.matchAll(/^p(\d+)$/gm)].map((match) => match[1]);
	if (!pids.length) return [];
	const directories = spawnSync('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'], {
		encoding: 'utf8',
		timeout: 1_500,
		maxBuffer: 1_000_000
	});
	return parseDevServers(listeners.stdout, directories.error ? '' : directories.stdout);
}

export function stoppableDevServer(
	servers: DevServer[],
	pid: number,
	port: number
): DevServer | undefined {
	return servers.find((server) => server.pid === pid && server.port === port && server.canStop);
}

export function stopDevServer(pid: number, port: number): void {
	if (!stoppableDevServer(discoverDevServers(), pid, port)) {
		throw new Error('This listener is protected or no longer running');
	}
	process.kill(pid, 'SIGTERM');
}

export function localDiscoveryAllowed(
	request: Request,
	url: URL,
	clientAddress: string | undefined
): boolean {
	if (
		!clientAddress ||
		(request.headers.get('host') ?? url.host) !== url.host ||
		['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].some((header) =>
			request.headers.has(header)
		) ||
		(request.headers.has('origin') && !requestOriginMatches(request, url))
	)
		return false;
	return (
		['127.0.0.1', '::1'].includes(clientAddress.replace(/^::ffff:/, '')) &&
		['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
	);
}
