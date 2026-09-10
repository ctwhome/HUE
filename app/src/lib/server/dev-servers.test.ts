import { expect, test } from 'bun:test';
import {
	discoverDevServers,
	localDiscoveryAllowed,
	parseDevServers,
	stoppableDevServer
} from './dev-servers';

test('listener discovery awaits bounded asynchronous processes', async () => {
	const calls: string[][] = [];
	const servers = await discoverDevServers(async (_command, args, options) => {
		calls.push(args);
		expect(options).toMatchObject({ timeout: 1_500, maxBuffer: 1_000_000 });
		await Bun.sleep(1);
		return {
			status: 0,
			stdout: calls.length === 1 ? 'p101\ncnode\nn*:5173\n' : 'p101\nn/tmp/app\n'
		};
	});
	expect(calls).toHaveLength(2);
	expect(servers).toMatchObject([{ port: 5173, folder: '/tmp/app' }]);
});

test('discovery distinguishes empty listeners from process failures', async () => {
	expect(await discoverDevServers(async () => ({ status: 1, stdout: '' }))).toEqual([]);
	expect(
		await discoverDevServers(async () => ({
			status: 1,
			stdout: '',
			error: Object.assign(new Error('No matches'), { code: 1 })
		}))
	).toEqual([]);
	await expect(
		discoverDevServers(async () => ({ status: null, stdout: '', error: new Error('timeout') }))
	).rejects.toThrow('discovery failed');
});

test('parses listener process metadata into sorted localhost servers', () => {
	expect(
		parseDevServers(
			`
p101
cnode
n127.0.0.1:5173
n*:5173
n[::1]:3000
p102
cpostgres
n*:5432
n*:postgresql
n*:70000
			`,
			'p101\nn/Users/me/project\np102\nn/Users/me/database\n',
			101,
			'/Users/me'
		)
	).toEqual([
		{
			port: 3000,
			url: 'http://localhost:3000',
			pid: 101,
			process: 'node',
			folder: '~/project',
			canStop: false
		},
		{
			port: 5173,
			url: 'http://localhost:5173',
			pid: 101,
			process: 'node',
			folder: '~/project',
			canStop: false
		},
		{
			port: 5432,
			url: 'http://localhost:5432',
			pid: 102,
			process: 'postgres',
			folder: '~/database',
			canStop: true
		}
	]);
});

test('only resolves an exact stoppable PID and port pair', () => {
	const servers = parseDevServers(
		'p101\ncnode\nn*:5173\np102\ncvite\nn*:4173\n',
		'p101\nn/tmp/app\np102\nn/tmp/app\n',
		101,
		'/Users/me'
	);

	expect(stoppableDevServer(servers, 102, 4173)?.process).toBe('vite');
	expect(stoppableDevServer(servers, 101, 5173)).toBeUndefined();
	expect(stoppableDevServer(servers, 102, 5173)).toBeUndefined();
});

test('only allows local, direct discovery requests', () => {
	const url = new URL('http://localhost:44010/api/dev-servers');
	const request = new Request(url, { headers: { host: url.host } });

	expect(localDiscoveryAllowed(request, url, '127.0.0.1')).toBe(true);
	expect(localDiscoveryAllowed(request, url, '::ffff:127.0.0.1')).toBe(true);
	expect(localDiscoveryAllowed(request, url, '100.64.0.2')).toBe(false);
	expect(
		localDiscoveryAllowed(
			new Request(url, { headers: { host: url.host, forwarded: 'for=127.0.0.1' } }),
			url,
			'127.0.0.1'
		)
	).toBe(false);
});
