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

export function localSameOriginMutationAllowed(
	request: Request,
	url: URL,
	clientAddress: string | undefined
): boolean {
	if (
		!clientAddress ||
		['forwarded', 'x-forwarded-for', 'x-forwarded-proto'].some((header) =>
			request.headers.has(header)
		)
	)
		return false;
	const address = clientAddress.replace(/^::ffff:/, '');
	return (
		['127.0.0.1', '::1'].includes(address) &&
		['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
		requestOriginMatches(request, url)
	);
}
