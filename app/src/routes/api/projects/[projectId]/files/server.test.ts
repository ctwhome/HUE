import { expect, test } from 'bun:test';
import { _contentHeaders, _fileMutationAllowed, _filePath, _parseRange } from './+server';

test('file mutations require loopback same-origin requests', () => {
	const localUrl = new URL('http://127.0.0.1:4173/api/projects/p/files');
	const local = new Request(localUrl, {
		method: 'POST',
		headers: { host: localUrl.host, origin: localUrl.origin }
	});
	const crossOrigin = new Request(localUrl, {
		method: 'POST',
		headers: { host: localUrl.host, origin: 'http://attacker.example' }
	});
	const missingOrigin = new Request(localUrl, {
		method: 'POST',
		headers: { host: localUrl.host }
	});
	const wrongScheme = new Request(localUrl, {
		method: 'POST',
		headers: { host: localUrl.host, origin: `https://${localUrl.host}` }
	});
	expect(_fileMutationAllowed(local, localUrl, '127.0.0.1')).toBe(true);
	expect(_fileMutationAllowed(local, localUrl, '203.0.113.9')).toBe(false);
	expect(_fileMutationAllowed(crossOrigin, localUrl, '127.0.0.1')).toBe(false);
	expect(_fileMutationAllowed(missingOrigin, localUrl, '127.0.0.1')).toBe(false);
	expect(_fileMutationAllowed(wrongScheme, localUrl, '127.0.0.1')).toBe(false);
});

test('parses one bounded byte range and rejects malformed or multiple ranges', () => {
	expect(_parseRange(null, 100)).toEqual({ start: 0, end: 99, partial: false });
	expect(_parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19, partial: true });
	expect(_parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99, partial: true });
	expect(() => _parseRange('bytes=20-10', 100)).toThrow('Invalid byte range');
	expect(() => _parseRange('bytes=0-1,4-5', 100)).toThrow('Invalid byte range');
});

test('content headers prevent sniffing and sanitize download names', () => {
	const headers = _contentHeaders('evil"\r\nSet-Cookie: bad.pdf', 'application/pdf', true);
	expect(headers.get('x-content-type-options')).toBe('nosniff');
	expect(headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
	expect(headers.get('content-disposition')).not.toContain('\r');
	expect(headers.get('content-disposition')).not.toContain('\n');
	expect(headers.get('content-disposition')).toContain("filename*=UTF-8''");
});

test('decodes file paths exactly once at the HTTP boundary', () => {
	expect(_filePath(new URL('http://127.0.0.1/files?path=%252e%252e'))).toBe('%2e%2e');
	expect(_filePath(new URL('http://127.0.0.1/files?path=%2e%2e%2Fsecret'))).toBe('../secret');
});
