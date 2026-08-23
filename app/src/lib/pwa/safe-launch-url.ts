export function safeLaunchUrl(candidate: unknown, origin: string) {
	try {
		const target = new URL(typeof candidate === 'string' ? candidate : '/', origin);
		return target.origin === origin ? target.href : new URL('/', origin).href;
	} catch {
		return new URL('/', origin).href;
	}
}
