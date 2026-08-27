function matches(value: string, pattern: string) {
	let source = '^';
	for (const character of pattern) {
		if (character === '*') source += '.*';
		else if (character === '?') source += '.';
		else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
	}
	return new RegExp(`${source}$`).test(value);
}

export function isFilePathHidden(path: string, value: string) {
	const parts = path.split('/');
	const prefixes = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
	return value
		.split('\n')
		.map((pattern) => pattern.trim().replace(/^\.\//, '').replace(/\/$/, ''))
		.filter(Boolean)
		.some((pattern) =>
			(pattern.includes('/') ? prefixes : parts).some((candidate) => matches(candidate, pattern))
		);
}
