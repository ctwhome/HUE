/// <reference lib="webworker" />
import { build, version } from '$service-worker';
import { safeLaunchUrl } from '$lib/pwa/safe-launch-url';

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `hue-static-${version}`;

worker.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(build)));
	void worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith('hue-static-') && key !== CACHE)
						.map((key) => caches.delete(key))
				)
			)
			.then(() => worker.clients.claim())
	);
});

worker.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== worker.location.origin || !build.includes(url.pathname)) return;
	event.respondWith(
		caches
			.open(CACHE)
			.then(async (cache) => (await cache.match(event.request)) ?? fetch(event.request))
	);
});

worker.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = safeLaunchUrl(event.notification.data?.url, worker.location.origin);
	event.waitUntil(
		worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
			const client = clients[0] as WindowClient | undefined;
			if (client) {
				await client.navigate(url);
				return client.focus();
			}
			return worker.clients.openWindow(url);
		})
	);
});
