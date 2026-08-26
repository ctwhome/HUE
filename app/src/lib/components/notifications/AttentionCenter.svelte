<script lang="ts">
	import { onMount } from 'svelte';
	import { Bell, Check, Settings, Trash2, X } from 'lucide-svelte';
	import {
		acknowledgeThenNavigate,
		attentionState,
		decodeApplicationServerKey,
		notificationCapability,
		shouldPlaySound,
		shouldPresentForeground
	} from '$lib/notifications/client';

	type Item = {
		id: string;
		projectId: string | null;
		sessionId: string;
		kind: 'completed' | 'permission' | 'clarify' | 'failed' | 'unknown';
		priority: 'normal' | 'high';
		title: string;
		body: string;
		path: string;
		createdAt: string;
		readAt: string | null;
		dismissedAt: string | null;
		actedAt: string | null;
	};
	type Endpoint = {
		id: string;
		deviceId: string;
		name: string;
		enabled: boolean;
		revokedAt: string | null;
	};
	type Status = { available: boolean; publicKey: string | null; reason: string | null };

	let {
		open,
		projectId,
		sessionId,
		onclose,
		oncounts
	}: {
		open: boolean;
		projectId: string | null;
		sessionId: string | null;
		onclose: () => void;
		oncounts: (unread: number) => void;
	} = $props();

	let items = $state<Item[]>([]);
	let unread = $state(0);
	let loading = $state(true);
	let error = $state('');
	let nextCursor = $state<string | null>(null);
	let view = $state<'unread' | 'all'>('unread');
	let settings = $state(false);
	let status = $state<Status>({ available: false, publicKey: null, reason: 'not-configured' });
	let endpoints = $state<Endpoint[]>([]);
	let deviceName = $state('This device');
	let settingsNotice = $state('');
	let soundEnabled = $state(false);
	let foregroundEnabled = $state(false);
	let audioUnlocked = $state(false);
	let modal = $state<HTMLDialogElement>();
	let initialized = false;
	let known = new Set<string>();
	let audioContext: AudioContext | null = null;
	let refreshGeneration = 0;
	let refreshesInFlight = 0;
	let markingAllRead = $state(false);
	let centerState = $derived(attentionState({ loading, error, items, unread }));
	const endpointKey = 'hue:notification:endpoint-id';
	const deviceKey = 'hue:notification:device-id';
	const soundKey = 'hue:notification:sound';
	const foregroundKey = 'hue:notification:foreground';

	$effect(() => {
		if (open && modal && !modal.open) modal.showModal();
	});

	async function api<T>(url: string, options?: RequestInit): Promise<T> {
		const response = await fetch(url, {
			...options,
			headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }
		});
		const body =
			response.status === 204 ? ({} as T) : ((await response.json()) as T & { error?: string });
		if (!response.ok)
			throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`);
		return body;
	}

	function capability() {
		return notificationCapability({
			secure: window.isSecureContext,
			notification: 'Notification' in window,
			push: 'serviceWorker' in navigator && 'PushManager' in window,
			permission: 'Notification' in window ? Notification.permission : 'default'
		});
	}

	function capabilityCopy() {
		if (!status.available)
			return status.reason === 'invalid-config'
				? 'Web Push configuration is invalid.'
				: 'Web Push is not configured on this HUE server.';
		switch (capability()) {
			case 'insecure':
				return 'System notifications require a secure context.';
			case 'unavailable':
				return 'This browser does not support system notifications.';
			case 'push-unavailable':
				return 'This browser does not support Web Push.';
			case 'denied':
				return 'Notification permission is denied in browser settings.';
			case 'ready':
				return 'System notifications are available.';
			default:
				return 'Permission has not been requested.';
		}
	}

	async function refresh(reset = true, background = false) {
		if (background && refreshesInFlight > 0) return;
		const request = ++refreshGeneration;
		const requestedView = view;
		const requestedCursor = !reset ? nextCursor : null;
		refreshesInFlight += 1;
		if (!background) {
			if (reset) loading = true;
			error = '';
		}
		try {
			const query = new URLSearchParams({ view: requestedView, limit: '50' });
			if (requestedCursor) query.set('cursor', requestedCursor);
			const body = await api<{
				items: Item[];
				nextCursor: string | null;
				counts: { unread: number; all: number };
			}>(`/api/notifications?${query}`);
			if (request !== refreshGeneration) return;
			const incoming = body.items.filter((item) => !known.has(item.id));
			if (initialized) for (const item of incoming.toReversed()) present(item);
			for (const item of body.items) known.add(item.id);
			initialized = true;
			items = reset ? body.items : [...items, ...body.items];
			nextCursor = body.nextCursor;
			unread = body.counts.unread;
			oncounts(unread);
			updateBadge(unread);
		} catch {
			if (request === refreshGeneration && !background) error = 'Unable to load notifications';
		} finally {
			refreshesInFlight -= 1;
			if (request === refreshGeneration && !background) loading = false;
		}
	}

	function present(item: Item) {
		const presented = shouldPresentForeground(item, {
			projectId,
			sessionId,
			visible: document.visibilityState === 'visible'
		});
		if (!presented) return;
		if (foregroundEnabled && 'Notification' in window && Notification.permission === 'granted') {
			const notice = new Notification(item.title, {
				body: item.body,
				icon: '/icons/hue-192.png',
				tag: item.id,
				data: { url: item.path }
			});
			notice.onclick = () => {
				notice.close();
				void acknowledgeThenNavigate(
					() => markActed(item),
					() => window.focus(),
					() => window.location.assign(item.path)
				);
			};
		}
		if (shouldPlaySound({ enabled: soundEnabled, unlocked: audioUnlocked }, presented)) playChime();
	}

	function updateBadge(count: number) {
		const badge = navigator as Navigator & {
			setAppBadge?: (count: number) => Promise<void>;
			clearAppBadge?: () => Promise<void>;
		};
		void (count ? badge.setAppBadge?.(count) : badge.clearAppBadge?.())?.catch(() => undefined);
	}

	function playChime() {
		if (!audioContext) return;
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		oscillator.frequency.value = 660;
		gain.gain.setValueAtTime(0.05, audioContext.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.18);
		oscillator.connect(gain).connect(audioContext.destination);
		oscillator.start();
		oscillator.stop(audioContext.currentTime + 0.18);
	}

	async function toggleSound(enabled: boolean) {
		soundEnabled = enabled;
		localStorage.setItem(soundKey, String(enabled));
		if (!enabled) return;
		const AudioContextClass = window.AudioContext;
		audioContext ??= new AudioContextClass();
		await audioContext.resume();
		audioUnlocked = true;
		playChime();
	}

	async function mutate(id: string, state: 'read' | 'dismissed' | 'acted') {
		try {
			await api(`/api/notifications/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: JSON.stringify({ state })
			});
			await refresh();
		} catch {
			error = 'Unable to update notification';
		}
	}

	function markActed(item: Item, keepalive = false) {
		return api(`/api/notifications/${encodeURIComponent(item.id)}`, {
			method: 'PATCH',
			body: JSON.stringify({ state: 'acted' }),
			keepalive
		});
	}

	async function openNotification(event: MouseEvent, item: Item) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			void markActed(item, true).catch(() => undefined);
			return;
		}
		event.preventDefault();
		await acknowledgeThenNavigate(
			() => markActed(item),
			() => window.focus(),
			() => window.location.assign(item.path)
		);
	}

	async function markAllRead() {
		markingAllRead = true;
		try {
			await api('/api/notifications', { method: 'PATCH' });
			await refresh();
		} catch {
			error = 'Unable to update notifications';
		} finally {
			markingAllRead = false;
		}
	}

	async function loadSettings() {
		settingsNotice = '';
		try {
			[status, { endpoints }] = await Promise.all([
				api<Status>('/api/notifications/status'),
				api<{ endpoints: Endpoint[] }>('/api/notifications/endpoints')
			]);
		} catch {
			settingsNotice = 'Unable to load notification settings.';
		}
	}

	async function enableSystemNotifications() {
		settingsNotice = '';
		if (!status.available || !status.publicKey) return;
		try {
			// Called only by Enable system notifications button user gesture.
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				settingsNotice =
					permission === 'denied'
						? 'Permission denied. Change it in browser settings.'
						: 'Permission was not granted.';
				return;
			}
			const registration = await navigator.serviceWorker.ready;
			const subscription =
				(await registration.pushManager.getSubscription()) ??
				(await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: decodeApplicationServerKey(status.publicKey)
				}));
			const json = subscription.toJSON();
			if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('invalid');
			let deviceId = localStorage.getItem(deviceKey);
			if (!deviceId) {
				deviceId = crypto.randomUUID();
				localStorage.setItem(deviceKey, deviceId);
			}
			const endpoint = await api<Endpoint>('/api/notifications/endpoints', {
				method: 'POST',
				body: JSON.stringify({
					deviceId,
					name: deviceName,
					endpoint: json.endpoint,
					keys: json.keys
				})
			});
			localStorage.setItem(endpointKey, endpoint.id);
			foregroundEnabled = true;
			localStorage.setItem(foregroundKey, 'true');
			settingsNotice = 'System notifications enabled for this device.';
			await loadSettings();
			await reportPresence();
		} catch {
			settingsNotice = 'Unable to create a push subscription.';
		}
	}

	async function updateEndpoint(
		endpoint: Endpoint,
		input: { name?: string; enabled?: boolean; revoke?: true }
	) {
		try {
			await api(`/api/notifications/endpoints/${encodeURIComponent(endpoint.id)}`, {
				method: 'PATCH',
				body: JSON.stringify(input)
			});
			await loadSettings();
		} catch {
			settingsNotice = 'Unable to update this device.';
		}
	}

	async function deleteEndpoint(endpoint: Endpoint) {
		try {
			await api(`/api/notifications/endpoints/${encodeURIComponent(endpoint.id)}`, {
				method: 'DELETE'
			});
			if (localStorage.getItem(endpointKey) === endpoint.id) localStorage.removeItem(endpointKey);
			await loadSettings();
		} catch {
			settingsNotice = 'Unable to delete this device.';
		}
	}

	async function reportPresence() {
		const endpointId = localStorage.getItem(endpointKey);
		if (!endpointId) return;
		await api('/api/notifications/presence', {
			method: 'POST',
			body: JSON.stringify({
				endpointId,
				projectId,
				sessionId,
				visible: document.visibilityState === 'visible'
			})
		}).catch(() => undefined);
	}

	$effect(() => {
		projectId;
		sessionId;
		void reportPresence();
	});

	onMount(() => {
		soundEnabled = localStorage.getItem(soundKey) === 'true';
		foregroundEnabled = localStorage.getItem(foregroundKey) === 'true';
		void refresh();
		void loadSettings();
		void reportPresence();
		const poll = setInterval(() => void refresh(true, true), 5_000);
		const presence = setInterval(() => void reportPresence(), 30_000);
		const visibility = () => void reportPresence();
		document.addEventListener('visibilitychange', visibility);
		return () => {
			clearInterval(poll);
			clearInterval(presence);
			document.removeEventListener('visibilitychange', visibility);
		};
	});
</script>

{#if open}
	<dialog
		bind:this={modal}
		class="global-panel min-w-0 bg-background p-0 text-foreground"
		aria-label="Notifications dialog"
		oncancel={(event) => {
			event.preventDefault();
			onclose();
		}}
		onclick={(event) => event.target === modal && onclose()}
	>
		<section class="flex h-full min-h-0 flex-col" aria-label="Notifications">
			<header class="flex min-h-16 items-center gap-3 border-b border-border px-5 max-[700px]:px-3">
				<button
					class="grid size-11 place-items-center rounded-md border border-border"
					aria-label="Close notifications"
					title="Close notifications"
					onclick={onclose}><X class="size-5" aria-hidden="true" /></button
				>
				<div class="min-w-0 flex-1">
					<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
						Attention
					</p>
					<h1 class="text-xl font-semibold">Notifications</h1>
				</div>
				<button
					class="grid size-11 place-items-center rounded-md border border-border"
					class:bg-accent={settings}
					aria-label="Notification settings"
					title="Notification settings"
					onclick={() => {
						settings = !settings;
						if (settings) void loadSettings();
					}}><Settings class="size-5" aria-hidden="true" /></button
				>
			</header>

			{#if settings}
				<div class="flex-1 overflow-auto p-[clamp(16px,4vw,48px)]">
					<div class="mx-auto grid max-w-3xl gap-6">
						<section class="grid gap-3 rounded-xl border border-border p-5">
							<h2 class="text-lg font-semibold">Notification settings</h2>
							<p class="text-sm text-muted-foreground">
								HUE keeps canonical notifications in-app. System notifications contain generic text
								and open HUE for current context.
							</p>
							<p class="text-sm" role="status">{capabilityCopy()}</p>
							<label class="grid gap-1 text-sm"
								><span>Device name</span><input
									class="min-h-11 rounded-md border border-border bg-background px-3"
									maxlength="80"
									bind:value={deviceName}
								/></label
							>
							<button
								class="min-h-11 justify-self-start rounded-md bg-primary px-4 text-primary-foreground disabled:opacity-50"
								disabled={!status.available ||
									capability() === 'denied' ||
									capability() === 'insecure' ||
									capability() === 'unavailable' ||
									capability() === 'push-unavailable'}
								onclick={enableSystemNotifications}>Enable system notifications</button
							>
							{#if settingsNotice}<p class="text-sm" role="status">{settingsNotice}</p>{/if}
						</section>

						<section class="grid gap-3 rounded-xl border border-border p-5">
							<h2 class="font-semibold">Foreground behavior</h2>
							<label class="flex min-h-11 items-center gap-3"
								><input
									type="checkbox"
									bind:checked={foregroundEnabled}
									onchange={() => localStorage.setItem(foregroundKey, String(foregroundEnabled))}
								/><span>Show browser notifications while HUE is open</span></label
							>
							<label class="flex min-h-11 items-center gap-3"
								><input
									type="checkbox"
									checked={soundEnabled}
									onchange={(event) => void toggleSound(event.currentTarget.checked)}
								/><span>Foreground sound</span></label
							>
							<p class="text-sm text-muted-foreground">
								Sound starts only after this explicit opt-in user gesture. Background PWA sound
								follows browser and operating-system settings; HUE cannot choose or bypass it.
							</p>
							<p class="text-sm text-muted-foreground">
								Wear OS mirroring is best effort and controlled by phone, browser, and watch
								notification settings.
							</p>
						</section>

						<section class="grid gap-3 rounded-xl border border-border p-5">
							<h2 class="font-semibold">Devices</h2>
							{#if endpoints.length === 0}<p class="text-sm text-muted-foreground">
									No subscribed devices.
								</p>{/if}
							{#each endpoints as endpoint (endpoint.id)}
								<div class="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
									<div class="min-w-40 flex-1">
										<strong>{endpoint.name}</strong>
										<p class="text-xs text-muted-foreground">
											{endpoint.revokedAt ? 'Revoked' : endpoint.enabled ? 'Enabled' : 'Disabled'}
										</p>
									</div>
									<button
										class="min-h-11 rounded-md border border-border px-3"
										onclick={() => {
											const name = window.prompt('Device name', endpoint.name);
											if (name) void updateEndpoint(endpoint, { name });
										}}>Rename</button
									>
									<button
										class="min-h-11 rounded-md border border-border px-3"
										onclick={() => void updateEndpoint(endpoint, { enabled: !endpoint.enabled })}
										>{endpoint.enabled ? 'Disable' : 'Enable'}</button
									>
									<button
										class="min-h-11 rounded-md border border-border px-3"
										onclick={() => void updateEndpoint(endpoint, { revoke: true })}>Revoke</button
									>
									<button
										class="grid size-11 place-items-center rounded-md border border-destructive/50 text-destructive"
										aria-label={`Delete ${endpoint.name}`}
										title={`Delete ${endpoint.name}`}
										onclick={() => void deleteEndpoint(endpoint)}
										><Trash2 class="size-4" aria-hidden="true" /></button
									>
								</div>
							{/each}
						</section>
					</div>
				</div>
			{:else}
				<div class="flex min-h-14 items-center gap-2 border-b border-border px-5 max-[700px]:px-3">
					<button
						class="min-h-11 rounded-md px-3"
						class:bg-accent={view === 'unread'}
						aria-pressed={view === 'unread'}
						onclick={() => {
							view = 'unread';
							void refresh();
						}}
						>Unread <span
							class="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground"
							>{unread}</span
						></button
					>
					<button
						class="min-h-11 rounded-md px-3"
						class:bg-accent={view === 'all'}
						aria-pressed={view === 'all'}
						onclick={() => {
							view = 'all';
							void refresh();
						}}>All</button
					>
					{#if unread > 0}<button
							class="ml-auto min-h-11 rounded-md border border-border px-3 disabled:opacity-50"
							disabled={markingAllRead}
							onclick={() => void markAllRead()}>Mark all read</button
						>{/if}
				</div>
				<div class="flex-1 overflow-auto p-[clamp(12px,3vw,36px)]" aria-live="polite">
					{#if centerState.view === 'loading'}
						<p class="mx-auto mt-16 max-w-xl text-center text-muted-foreground">
							Loading notifications…
						</p>
					{:else if centerState.view === 'error'}
						<div class="mx-auto mt-16 grid max-w-xl justify-items-center gap-3 text-center">
							<Bell class="size-8" aria-hidden="true" />
							<p>Unable to load notifications</p>
							<button
								class="min-h-11 rounded-md border border-border px-4"
								onclick={() => void refresh()}>Try again</button
							>
						</div>
					{:else if centerState.view === 'empty'}
						<div
							class="mx-auto mt-16 grid max-w-xl justify-items-center gap-3 text-center text-muted-foreground"
						>
							<Check class="size-8" aria-hidden="true" />
							<p>No notifications</p>
							<p class="text-sm">New outcomes and requests will appear here.</p>
						</div>
					{:else}
						<ul class="mx-auto grid max-w-3xl gap-3">
							{#each items as item (item.id)}
								<li
									class="rounded-xl border border-border bg-card p-4"
									class:opacity-65={Boolean(item.readAt || item.dismissedAt)}
								>
									<div class="flex items-start gap-3">
										<span
											class="mt-1 size-2.5 shrink-0 rounded-full"
											class:bg-destructive={item.priority === 'high'}
											class:bg-primary={item.priority === 'normal'}
											aria-hidden="true"
										></span>
										<div class="min-w-0 flex-1">
											<a
												class="font-semibold hover:underline"
												href={item.path}
												onclick={(event) => void openNotification(event, item)}>{item.title}</a
											>
											<p class="mt-1 text-sm text-muted-foreground">{item.body}</p>
											<time
												class="mt-2 block text-xs text-muted-foreground"
												datetime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time
											>
										</div>
									</div>
									<div class="mt-3 flex flex-wrap justify-end gap-2">
										{#if !item.readAt}<button
												class="min-h-11 rounded-md border border-border px-3"
												onclick={() => void mutate(item.id, 'read')}>Mark read</button
											>{/if}<button
											class="min-h-11 rounded-md border border-border px-3"
											onclick={() => void mutate(item.id, 'dismissed')}
											><X class="mr-1 inline size-4" aria-hidden="true" />Dismiss</button
										>
									</div>
								</li>
							{/each}
						</ul>
						{#if nextCursor}<button
								class="mx-auto mt-5 block min-h-11 rounded-md border border-border px-4"
								onclick={() => void refresh(false)}>Load more</button
							>{/if}
					{/if}
				</div>
			{/if}
		</section>
	</dialog>
{/if}
