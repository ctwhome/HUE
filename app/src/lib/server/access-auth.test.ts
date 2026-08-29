import { expect, test } from 'bun:test';
import {
	ACCESS_COOKIE,
	ACCESS_SESSION_SECONDS,
	accessSessionValid,
	createAccessSession,
	requestAccessAllowed,
	secretsEqual,
	sessionCookieOptions
} from './access-auth';

const secret = 'a-long-random-access-secret';
const now = 1_800_000_000_000;

function request(url: string, cookie?: string, origin?: string) {
	return new Request(url, {
		headers: {
			host: new URL(url).host,
			...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
			...(origin ? { origin } : {})
		}
	});
}

test('loopback access remains available without configuration', () => {
	const local = request('http://127.0.0.1:4010/');

	expect(requestAccessAllowed(local, new URL(local.url), '127.0.0.1', undefined, now)).toBe(true);
	expect(requestAccessAllowed(local, new URL(local.url), '203.0.113.8', undefined, now)).toBe(
		false
	);
});

test('a loopback reverse proxy cannot receive the local bypass', () => {
	const local = new Request('http://localhost:4010/', {
		headers: {
			host: 'localhost:4010',
			'x-forwarded-for': '100.64.0.2',
			'x-forwarded-proto': 'https'
		}
	});

	expect(requestAccessAllowed(local, new URL(local.url), '127.0.0.1', undefined, now)).toBe(false);
});

test('remote access accepts same-host HTTPS terminated at an HTTP proxy', () => {
	const token = createAccessSession(secret, now);
	const remote = new Request('http://hue.example.test/api/projects', {
		headers: {
			host: 'hue.example.test',
			origin: 'https://hue.example.test',
			cookie: `${ACCESS_COOKIE}=${token}`
		}
	});

	expect(requestAccessAllowed(remote, new URL(remote.url), '100.64.0.2', secret, now)).toBe(true);
});

test('remote access requires a configured secret and valid session', () => {
	const token = createAccessSession(secret, now);
	const remote = request('https://hue.example.test/', token);

	expect(requestAccessAllowed(remote, new URL(remote.url), '100.64.0.2', undefined, now)).toBe(
		false
	);
	expect(requestAccessAllowed(remote, new URL(remote.url), '100.64.0.2', secret, now)).toBe(true);
});

test('remote access preserves same-origin request protection', () => {
	const token = createAccessSession(secret, now);
	const crossOrigin = request('https://hue.example.test/api/projects', token, 'https://evil.test');

	expect(
		requestAccessAllowed(crossOrigin, new URL(crossOrigin.url), '100.64.0.2', secret, now)
	).toBe(false);
});

test('access sessions reject tampering and expiry', () => {
	const token = createAccessSession(secret, now);

	expect(accessSessionValid(token, secret, now)).toBe(true);
	expect(accessSessionValid(`${token.slice(0, -1)}x`, secret, now)).toBe(false);
	expect(accessSessionValid(token, secret, now + 7 * 24 * 60 * 60 * 1000)).toBe(false);
});

test('malformed cookie input is treated as unauthenticated', () => {
	const remote = request('https://hue.example.test/');
	remote.headers.set('cookie', `${ACCESS_COOKIE}=%`);

	expect(() =>
		requestAccessAllowed(remote, new URL(remote.url), '100.64.0.2', secret, now)
	).not.toThrow();
	expect(requestAccessAllowed(remote, new URL(remote.url), '100.64.0.2', secret, now)).toBe(false);
});

test('access cookie persists across top-level PWA launches', () => {
	expect(secretsEqual(secret, secret)).toBe(true);
	expect(secretsEqual(`${secret}x`, secret)).toBe(false);
	expect(sessionCookieOptions()).toEqual(
		expect.objectContaining({
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: '/',
			maxAge: ACCESS_SESSION_SECONDS
		})
	);
});
