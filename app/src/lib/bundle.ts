export const DEFAULT_BUNDLE = 'autonomous';

export function parseBundleReference(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const bundle = value.trim();
	return bundle && bundle.length <= 128 && !bundle.includes('\0') ? bundle : null;
}
