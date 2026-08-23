import { beforeEach, expect, mock, test } from 'bun:test';
import { serviceExportStubs } from '$lib/server/services-test-stubs';

const terminalCalls: Array<{ method: string; projectId: string; args: unknown[] }> = [];
let projectReads = 0;

mock.module('$lib/server/services', () => ({
	...serviceExportStubs,
	authoritativeProject: async () => {
		projectReads += 1;
		return { id: 'canonical-project', primary_path: '/work/hue' };
	},
	services: () => ({
		terminals: Object.fromEntries(
			['read', 'create', 'write', 'resize', 'close'].map((method) => [
				method,
				(projectId: string, ...args: unknown[]) => {
					terminalCalls.push({ method, projectId, args });
					return {};
				}
			])
		)
	})
}));

beforeEach(() => {
	terminalCalls.length = 0;
	projectReads = 0;
});

test('terminal access uses the client address instead of a spoofable host header', () => {
	const { _terminalAllowed } = require('./+server');
	const url = new URL('http://localhost/api/projects/project-1/terminal');
	const spoofed = new Request(url, {
		method: 'POST',
		headers: { host: 'localhost', origin: url.origin }
	});

	expect(_terminalAllowed(spoofed, url, '203.0.113.10', true)).toBe(false);
	expect(_terminalAllowed(spoofed, url, '127.0.0.1', true)).toBe(true);
});

test('terminal mutations require a same-origin browser request', () => {
	const { _terminalAllowed } = require('./+server');
	const url = new URL('http://localhost/api/projects/project-1/terminal');

	expect(_terminalAllowed(new Request(url, { method: 'POST' }), url, '127.0.0.1', true)).toBe(
		false
	);
	expect(
		_terminalAllowed(
			new Request(url, { method: 'POST', headers: { origin: 'https://example.test' } }),
			url,
			'127.0.0.1',
			true
		)
	).toBe(false);
});

test('terminal access rejects DNS rebinding hosts', () => {
	const { _terminalAllowed } = require('./+server');
	const url = new URL('http://attacker.example/api/projects/project-1/terminal');
	const request = new Request(url, {
		method: 'POST',
		headers: { host: 'attacker.example', origin: url.origin }
	});

	expect(_terminalAllowed(request, url, '127.0.0.1', true)).toBe(false);
});

test('uses canonical Hermes id for every terminal operation reached by slug', async () => {
	const { GET, POST } = await import('./+server');
	const url = new URL('http://localhost/api/projects/project-slug/terminal?terminalId=t&after=2');
	const base = {
		params: { projectId: 'project-slug' },
		url,
		getClientAddress: () => '127.0.0.1'
	};
	await GET({ ...base, request: new Request(url) } as never);
	for (const body of [
		{ action: 'create', cols: 80, rows: 24 },
		{ action: 'input', terminalId: 't', sequence: 1, data: 'pwd\n' },
		{ action: 'resize', terminalId: 't', cols: 100, rows: 30 },
		{ action: 'close', terminalId: 't' }
	]) {
		await POST({
			...base,
			request: new Request(url, {
				method: 'POST',
				headers: { origin: url.origin },
				body: JSON.stringify(body)
			})
		} as never);
	}

	expect(projectReads).toBe(5);
	expect(terminalCalls.map(({ method }) => method)).toEqual([
		'read',
		'create',
		'write',
		'resize',
		'close'
	]);
	expect(terminalCalls.every(({ projectId }) => projectId === 'canonical-project')).toBe(true);
	expect(terminalCalls.find(({ method }) => method === 'create')?.args[0]).toBe('/work/hue');
});
