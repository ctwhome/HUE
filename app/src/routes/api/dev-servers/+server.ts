import { json } from '@sveltejs/kit';
import { discoverDevServers, localDiscoveryAllowed, stopDevServer } from '$lib/server/dev-servers';
import { localSameOriginMutationAllowed } from '$lib/server/same-origin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request, url, getClientAddress }) => {
	if (!localDiscoveryAllowed(request, url, getClientAddress())) {
		return json({ error: 'Local server discovery is limited to this device' }, { status: 403 });
	}
	return json({ servers: discoverDevServers() });
};

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	if (!localSameOriginMutationAllowed(request, url, getClientAddress())) {
		return json({ error: 'Stopping local servers is limited to this device' }, { status: 403 });
	}
	try {
		const { pid, port } = (await request.json()) as { pid?: number; port?: number };
		if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(port)) throw new Error('Invalid listener');
		stopDevServer(pid!, port!);
		return json({ stopped: true });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
