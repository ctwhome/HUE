const SECRET_PARTS = new Set([
	'token',
	'secret',
	'password',
	'authorization',
	'cookie',
	'credential',
	'passwd'
]);
const SECRET_SEMANTIC_PARTS = new Set(['token', 'secret', 'password', 'credential', 'passwd']);
const SECRET_VALUE_PARTS = new Set(['value', 'hash', 'id']);
const AUTHORIZATION = /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"']+/gi;
const AUTHORIZATION_WITH_BEARER = /(authorization\s*[:=]\s*)(bearer\s+)?[^\s"']+/gi;
const BEARER = /(\bbearer\s+)(?=[^\s]*[\d._~+/=-])[^\s"']+/gi;
const SECRET_FLAG = /((?:--?)[a-z0-9_-]*(?:api[-_]?key|token|secret|password)(?:=|\s+))[^\s]+/gi;
const SECRET_ASSIGNMENT =
	/(\b(?:[a-z][a-z0-9_-]*_)?(?:secret[-_]?access[-_]?key|api[-_]?key|token|secret|password)\s*=\s*)[^\s"']+/gi;
const COOKIE_HEADER = /(\b(?:set-cookie|cookie)\s*[:=]\s*)[^\r\n]+/gi;
const PRIVATE_KEY_BLOCK =
	/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?-----END \1-----/g;
const URL_TEXT = /https?:\/\/[^\s"'<>]+/gi;

function secretKey(key: string) {
	const compact = key.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const parts = key
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const last = parts.at(-1) ?? '';
	return (
		SECRET_PARTS.has(last) ||
		parts.some(
			(part, index) =>
				SECRET_SEMANTIC_PARTS.has(part) && SECRET_VALUE_PARTS.has(parts[index + 1] ?? '')
		) ||
		compact === 'credential' ||
		compact === 'credentials' ||
		compact === 'setcookie' ||
		(parts.includes('api') && parts.includes('key')) ||
		(parts.includes('private') && parts.includes('key')) ||
		(parts.includes('secret') && parts.includes('access') && parts.includes('key'))
	);
}

function safeUrl(raw: string, preserveUserinfoMarker: boolean) {
	let suffix = '';
	while (/[),.;\]}]$/.test(raw)) {
		suffix = raw.at(-1) + suffix;
		raw = raw.slice(0, -1);
	}
	try {
		const url = new URL(raw);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw + suffix;
		const hadUserinfo = Boolean(url.username || url.password);
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		let safe = url.toString().replace(/\/$/, raw.endsWith('/') ? '/' : '');
		if (preserveUserinfoMarker && hadUserinfo)
			safe = safe.replace(`${url.protocol}//`, `${url.protocol}//[REDACTED]@`);
		return safe + suffix;
	} catch {
		return raw + suffix;
	}
}

function redactString(value: string, preserveAuthorizationBearer: boolean): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			return JSON.stringify(redactValue(JSON.parse(value), '', preserveAuthorizationBearer));
		} catch {
			// Preserve non-JSON strings and continue with text redaction.
		}
	}
	return value
		.replace(PRIVATE_KEY_BLOCK, '[REDACTED]')
		.replace(URL_TEXT, (url) => safeUrl(url, !preserveAuthorizationBearer))
		.replace(COOKIE_HEADER, '$1[REDACTED]')
		.replace(
			preserveAuthorizationBearer ? AUTHORIZATION_WITH_BEARER : AUTHORIZATION,
			preserveAuthorizationBearer ? '$1$2[REDACTED]' : '$1[REDACTED]'
		)
		.replace(BEARER, '$1[REDACTED]')
		.replace(SECRET_FLAG, '$1[REDACTED]')
		.replace(SECRET_ASSIGNMENT, '$1[REDACTED]');
}

function redactValue(value: unknown, key: string, preserveAuthorizationBearer: boolean): unknown {
	if (secretKey(key)) return '[REDACTED]';
	if (typeof value === 'string') return redactString(value, preserveAuthorizationBearer);
	if (Array.isArray(value))
		return value.map((item) => redactValue(item, '', preserveAuthorizationBearer));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
				childKey,
				redactValue(child, childKey, preserveAuthorizationBearer)
			])
		);
	}
	return value;
}

export function redactHermesValue(value: unknown, key = ''): unknown {
	return redactValue(value, key, true);
}

export function redactPersistedValue(value: unknown, key = ''): unknown {
	return redactValue(value, key, false);
}
