export function sameOriginMutationAllowed(request: Request, url: URL): boolean {
	const origin = request.headers.get('origin');
	const host = request.headers.get('host');
	return !!origin && !!host && host === url.host && origin === url.origin;
}
