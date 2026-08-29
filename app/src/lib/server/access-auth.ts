import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { requestOriginMatches } from './same-origin';

export const ACCESS_COOKIE = 'hue_access';
export const ACCESS_SESSION_SECONDS = 7 * 24 * 60 * 60;

export function secretsEqual(candidate: string, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return timingSafeEqual(digest(candidate), digest(expected));
}

export function createAccessSession(secret: string, now = Date.now()): string {
	const payload = `${now + ACCESS_SESSION_SECONDS * 1000}.${randomBytes(24).toString('base64url')}`;
	return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function accessSessionValid(
	token: string | undefined,
	secret: string,
	now = Date.now()
): boolean {
	if (!token) return false;
	const separator = token.lastIndexOf('.');
	if (separator < 1) return false;
	const payload = token.slice(0, separator);
	const provided = token.slice(separator + 1);
	const expiresAt = Number(payload.slice(0, payload.indexOf('.')));
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
	const expected = createHmac('sha256', secret).update(payload).digest('base64url');
	return secretsEqual(provided, expected);
}

function cookieValue(request: Request): string | undefined {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const [name, ...value] = part.trim().split('=');
		if (name === ACCESS_COOKIE) {
			try {
				return decodeURIComponent(value.join('='));
			} catch {
				return undefined;
			}
		}
	}
}

function requestOriginAllowed(request: Request, url: URL): boolean {
	const host = request.headers.get('host') ?? url.host;
	if (host !== url.host) return false;
	return !request.headers.has('origin') || requestOriginMatches(request, url);
}

export function requestAccessAllowed(
	request: Request,
	url: URL,
	clientAddress: string | undefined,
	secret = process.env.HUE_ACCESS_SECRET,
	now = Date.now()
): boolean {
	if (!clientAddress || !requestOriginAllowed(request, url)) return false;
	const address = clientAddress.replace(/^::ffff:/, '');
	const proxied = ['forwarded', 'x-forwarded-for', 'x-forwarded-proto'].some((header) =>
		request.headers.has(header)
	);
	if (
		!proxied &&
		['127.0.0.1', '::1'].includes(address) &&
		['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
	)
		return true;
	return !!secret && accessSessionValid(cookieValue(request), secret, now);
}

export function sessionCookieOptions() {
	return {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax' as const,
		maxAge: ACCESS_SESSION_SECONDS
	};
}
