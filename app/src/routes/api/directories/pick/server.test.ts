import { expect, mock, test } from 'bun:test';

mock.module('$lib/server/system-folder-picker', () => ({ pickSystemFolder: async () => null }));

const { POST } = await import('./+server');

function event(origin: string) {
	const url = new URL('http://hue.example.test/api/directories/pick');
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin }
		}),
		url,
		getClientAddress: () => '100.64.0.2'
	} as never;
}

test('allows the authenticated same-origin app to open the host folder chooser', async () => {
	expect((await POST(event('https://hue.example.test'))).status).toBe(200);
});

test('rejects cross-origin folder chooser requests', async () => {
	expect((await POST(event('https://attacker.example'))).status).toBe(403);
});
