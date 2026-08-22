const SECRET_KEY =
	/^(?:authorization|cookie|credentials?|passwd|.*(?:api[-_]?key|private[-_]?key|token|secret|password|secret[-_]?access[-_]?key))$/i;
const AUTHORIZATION = /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"']+/gi;
const BEARER = /(\bbearer\s+)(?=[^\s]*[\d._~+/=-])[^\s"']+/gi;
const SECRET_FLAG = /((?:--?)[a-z0-9_-]*(?:api[-_]?key|token|secret|password)(?:=|\s+))[^\s]+/gi;
const SECRET_ASSIGNMENT =
	/(\b(?:[a-z][a-z0-9_-]*_)?(?:secret[-_]?access[-_]?key|api[-_]?key|token|secret|password)\s*=\s*)[^\s"']+/gi;
const URL_USERINFO = /(https?:\/\/)[^/@\s]+@/gi;

function redactString(value: string): string {
	return value
		.replace(AUTHORIZATION, '$1[REDACTED]')
		.replace(BEARER, '$1[REDACTED]')
		.replace(SECRET_FLAG, '$1[REDACTED]')
		.replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
		.replace(URL_USERINFO, '$1[REDACTED]@');
}

export function redactPersistedValue(value: unknown, key = ''): unknown {
	if (SECRET_KEY.test(key)) return '[REDACTED]';
	if (typeof value === 'string') return redactString(value);
	if (Array.isArray(value)) return value.map((item) => redactPersistedValue(item));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
				childKey,
				redactPersistedValue(child, childKey)
			])
		);
	}
	return value;
}
