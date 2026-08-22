const SECRET_PARTS = new Set([
	'token',
	'secret',
	'password',
	'authorization',
	'cookie',
	'credential'
]);
const SECRET_TEXT = [
	[/\b(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi, '$1[REDACTED]'],
	[
		/\b([A-Z0-9_-]*(?:API[-_]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE|CREDENTIAL)[A-Z0-9_-]*\s*=\s*)[^\s,;]+/gi,
		'$1[REDACTED]'
	]
] as const;
const URL_TEXT = /https?:\/\/[^\s"'<>]+/gi;

function secretKey(key: string) {
	const parts = key
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	return (
		SECRET_PARTS.has(parts.at(-1) ?? '') ||
		parts.some((part) => SECRET_PARTS.has(part)) ||
		(parts.includes('api') && parts.includes('key'))
	);
}

function safeUrl(raw: string) {
	let suffix = '';
	while (/[),.;\]}]$/.test(raw)) {
		suffix = raw.at(-1) + suffix;
		raw = raw.slice(0, -1);
	}
	try {
		const url = new URL(raw);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw + suffix;
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/, raw.endsWith('/') ? '/' : '') + suffix;
	} catch {
		return raw + suffix;
	}
}

function redactText(value: string) {
	let redacted = value.replace(URL_TEXT, safeUrl);
	for (const [pattern, replacement] of SECRET_TEXT)
		redacted = redacted.replace(pattern, replacement);
	return redacted;
}

export function redactHermesValue(value: unknown, key = ''): unknown {
	if (secretKey(key)) return '[REDACTED]';
	if (typeof value === 'string') return redactText(value);
	if (Array.isArray(value)) return value.map((item) => redactHermesValue(item));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, child]) => [
				childKey,
				redactHermesValue(child, childKey)
			])
		);
	}
	return value;
}
