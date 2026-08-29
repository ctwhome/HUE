import { json, type Handle } from '@sveltejs/kit';
import { requestAccessAllowed } from '$lib/server/access-auth';
import { services, shutdownServices } from '$lib/server/services';

services();

const lifecycle = globalThis as typeof globalThis & { __hueSignalsRegistered?: boolean };
if (process.env.NODE_ENV === 'production' && !lifecycle.__hueSignalsRegistered) {
	lifecycle.__hueSignalsRegistered = true;
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, () => {
			void shutdownServices().then(
				() => process.exit(0),
				() => process.exit(1)
			);
		});
	}
}

function publicLoginPath(pathname: string): boolean {
	return (
		pathname === '/login' ||
		pathname.startsWith('/_app/') ||
		pathname === '/favicon.png' ||
		pathname === '/manifest.webmanifest' ||
		pathname.startsWith('/icons/')
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	if (!publicLoginPath(event.url.pathname)) {
		let clientAddress: string | undefined;
		try {
			clientAddress = event.getClientAddress();
		} catch {
			clientAddress = undefined;
		}
		if (!requestAccessAllowed(event.request, event.url, clientAddress)) {
			if (event.url.pathname.startsWith('/api/')) {
				return json({ error: 'Authentication required' }, { status: 401 });
			}
			return new Response(null, { status: 303, headers: { location: '/login' } });
		}
	}
	return resolve(event);
};
