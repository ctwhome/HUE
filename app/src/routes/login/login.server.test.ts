import { afterEach, expect, test } from 'bun:test';
import { ACCESS_COOKIE, accessSessionValid } from '$lib/server/access-auth';

const originalSecret = process.env.HUE_ACCESS_SECRET;

afterEach(() => {
	if (originalSecret === undefined) delete process.env.HUE_ACCESS_SECRET;
	else process.env.HUE_ACCESS_SECRET = originalSecret;
});

function loginEvent(value: string, origin = 'https://hue.example.test') {
	const body = new FormData();
	body.set('secret', value);
	const url = new URL('https://hue.example.test/login');
	const written: Array<[string, string, Record<string, unknown>]> = [];
	return {
		event: {
			request: new Request(url, { method: 'POST', headers: { host: url.host, origin }, body }),
			url,
			cookies: { set: (...args: [string, string, Record<string, unknown>]) => written.push(args) }
		},
		written
	};
}

test('login rejects unavailable, incorrect, and cross-origin submissions generically', async () => {
	const { actions } = await import('./+page.server');
	delete process.env.HUE_ACCESS_SECRET;
	const unavailable = loginEvent('anything');
	expect(await actions.default(unavailable.event as never)).toEqual(
		expect.objectContaining({ status: 403, data: { error: 'Remote access is not configured' } })
	);

	process.env.HUE_ACCESS_SECRET = 'correct-secret';
	const incorrect = loginEvent('wrong-secret');
	expect(await actions.default(incorrect.event as never)).toEqual(
		expect.objectContaining({ status: 400, data: { error: 'Invalid access secret' } })
	);
	const crossOrigin = loginEvent('correct-secret', 'https://evil.test');
	expect(await actions.default(crossOrigin.event as never)).toEqual(
		expect.objectContaining({ status: 403, data: { error: 'Invalid login request' } })
	);
	expect([...unavailable.written, ...incorrect.written, ...crossOrigin.written]).toHaveLength(0);
});

test('login stores only a secure signed session and redirects home', async () => {
	const { actions } = await import('./+page.server');
	process.env.HUE_ACCESS_SECRET = 'correct-secret';
	const login = loginEvent(process.env.HUE_ACCESS_SECRET);

	try {
		await actions.default(login.event as never);
		expect.unreachable();
	} catch (cause) {
		expect(cause).toEqual(expect.objectContaining({ status: 303, location: '/' }));
	}

	expect(login.written).toHaveLength(1);
	const [name, token, options] = login.written[0];
	expect(name).toBe(ACCESS_COOKIE);
	expect(token).not.toContain(process.env.HUE_ACCESS_SECRET);
	expect(accessSessionValid(token, process.env.HUE_ACCESS_SECRET)).toBe(true);
	expect(options).toEqual(
		expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' })
	);
});
