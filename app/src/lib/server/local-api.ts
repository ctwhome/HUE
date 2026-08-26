import { requestAccessAllowed } from './access-auth';

export function localApiAllowed(
	request: Request,
	url: URL,
	clientAddress?: string,
	secret = process.env.HUE_ACCESS_SECRET
) {
	return requestAccessAllowed(request, url, clientAddress, secret);
}
