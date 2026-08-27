export function requestOriginMatches(request: Request, url: URL): boolean {
	const origin = request.headers.get('origin');
	const host = request.headers.get('host');
	if (!origin || !host || host !== url.host) return false;
	try {
		const browserOrigin = new URL(origin);
		return (
			browserOrigin.host === host &&
			(browserOrigin.protocol === url.protocol ||
				(browserOrigin.protocol === 'https:' && url.protocol === 'http:'))
		);
	} catch {
		return false;
	}
}

export function sameOriginMutationAllowed(request: Request, url: URL): boolean {
	return requestOriginMatches(request, url);
}
