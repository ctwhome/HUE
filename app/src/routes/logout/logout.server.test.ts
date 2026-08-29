import { expect, test } from 'bun:test';

test('logout requires same origin and securely clears the access session', async () => {
	const { POST } = await import('./+server');
	const url = new URL('https://hue.example.test/logout');
	const deleted: Array<[string, Record<string, unknown>]> = [];
	const cookies = { delete: (...args: [string, Record<string, unknown>]) => deleted.push(args) };

	const rejected = await POST({
		request: new Request(url, {
			method: 'POST',
			headers: { host: url.host, origin: 'https://evil.test' }
		}),
		url,
		cookies
	} as never);
	expect(rejected.status).toBe(403);
	expect(deleted).toHaveLength(0);

	const response = await POST({
		request: new Request(url, { method: 'POST', headers: { host: url.host, origin: url.origin } }),
		url,
		cookies
	} as never);
	expect(response.status).toBe(303);
	expect(response.headers.get('location')).toBe('/login');
	expect(deleted).toEqual([
		[
			'hue_access',
			expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
		]
	]);
});
