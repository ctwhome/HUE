export function localApiAllowed(request: Request, url: URL, clientAddress: string) {
	const address = clientAddress.replace(/^::ffff:/, '');
	if (!['127.0.0.1', '::1'].includes(address)) return false;
	const host = request.headers.get('host') ?? url.host;
	try {
		const hostname = new URL(`http://${host}`).hostname;
		if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return false;
		const origin = request.headers.get('origin');
		return !origin || new URL(origin).host === host;
	} catch {
		return false;
	}
}
