<script lang="ts">
	import { onMount } from 'svelte';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import { projectColorForeground } from '$lib/project-color';
	import { api } from './api';
	import { afterInitialPaint } from './after-initial-paint';

	type Check = {
		id: string;
		label: string;
		status: 'ready' | 'idle' | 'blocked' | 'unavailable';
		summary: string;
		action: string;
	};

	let {
		projectId,
		projectName,
		color,
		previewUrl,
		previewStatus = 'unverified'
	}: {
		projectId: string;
		projectName: string;
		color: string | null;
		previewUrl: string;
		previewStatus?: 'idle' | 'loading' | 'unverified' | 'ready' | 'error';
	} = $props();
	let checks = $state<Check[]>(
		['Project', 'Git', 'Terminal', 'Preview', 'Hermes ACP', 'Hermes admin'].map((label) => ({
			id: label.toLowerCase().replaceAll(' ', '-'),
			label,
			status: 'idle' as const,
			summary: 'Checking…',
			action: 'Wait for health check'
		}))
	);
	let error = $state('');
	let loading = $state(false);
	let lastRefresh = 0;
	let mounted = false;
	let cancelInitialLoad: (() => void) | null = null;
	let visibleChecks = $derived(
		checks.map((check) =>
			check.id === 'preview'
				? {
						...check,
						status:
							previewUrl && previewStatus === 'ready'
								? ('ready' as const)
								: previewStatus === 'error'
									? ('unavailable' as const)
									: ('idle' as const),
						summary: !previewUrl
							? 'No saved address'
							: previewStatus === 'ready'
								? 'Loaded'
								: previewStatus === 'loading'
									? 'Loading'
									: previewStatus === 'error'
										? 'Load failed'
										: 'Not verified',
						action: previewUrl
							? 'Inspect the Browser panel; a saved URL does not prove readiness'
							: 'Enter address in Browser panel'
					}
				: check
		)
	);

	async function load() {
		cancelInitialLoad?.();
		cancelInitialLoad = null;
		if (loading) return;
		loading = true;
		lastRefresh = Date.now();
		error = '';
		try {
			const result = (
				await api<{ checks: Check[] }>(`/api/health?projectId=${encodeURIComponent(projectId)}`)
			).checks;
			if (mounted) checks = result;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}
	function refreshOnFocus() {
		if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 30_000) void load();
	}

	onMount(() => {
		mounted = true;
		cancelInitialLoad = afterInitialPaint(() => void load());
		window.addEventListener('focus', refreshOnFocus);
		document.addEventListener('visibilitychange', refreshOnFocus);
		return () => {
			mounted = false;
			cancelInitialLoad?.();
			window.removeEventListener('focus', refreshOnFocus);
			document.removeEventListener('visibilitychange', refreshOnFocus);
		};
	});
</script>

<section
	class="project-status-bar flex min-w-0 items-center overflow-x-auto text-[11px] whitespace-nowrap"
	style={color
		? `--project-status-color: ${color}; --project-status-foreground: ${projectColorForeground(color)}`
		: undefined}
	aria-label="Runtime health"
	aria-busy={loading}
>
	<strong class="shrink-0 border-r border-border px-2.5">{projectName}</strong>
	<button
		class="grid min-h-7 min-w-7 shrink-0 place-items-center max-[700px]:min-h-11 max-[700px]:min-w-11"
		aria-label="Refresh health"
		title="Refresh health"
		disabled={loading}
		onclick={load}><RefreshCw width={14} height={14} aria-hidden="true" /></button
	>
	{#each visibleChecks as check}
		<div
			class="flex shrink-0 items-center gap-1.5 border-r border-border px-2"
			data-health-id={check.id}
			aria-label={`${check.label}: ${check.summary}. ${check.action}`}
			title={`${check.summary}. ${check.action}`}
		>
			<span
				class="size-1.5 rounded-full"
				aria-hidden="true"
				class:bg-[var(--success)]={check.status === 'ready' && !error}
				class:bg-[var(--warning)]={check.status === 'idle' || Boolean(error)}
				class:bg-destructive={check.status === 'blocked' || check.status === 'unavailable'}
			></span>
			<strong>{check.label}</strong><span class="opacity-75">{check.summary}</span>
		</div>
	{/each}
	{#if error}<span class="px-2 text-destructive" role="alert">Health unavailable: {error}</span
		>{/if}
</section>

<style>
	:global(.workspace:has(.project-status-bar)) {
		--project-status-height: 28px;
	}
	.project-status-bar {
		grid-column: 1 / -1;
		grid-row: 2;
		height: calc(var(--project-status-height) + env(safe-area-inset-bottom, 0px));
		padding-bottom: env(safe-area-inset-bottom, 0px);
		border-color: color-mix(in srgb, currentColor 25%, transparent);
		background: var(--project-status-color, var(--card));
		color: var(--project-status-foreground, var(--foreground));
		scrollbar-width: none;
	}
	.project-status-bar > * {
		border-color: color-mix(in srgb, currentColor 25%, transparent);
	}
	.project-status-bar::-webkit-scrollbar {
		display: none;
	}
	@media (min-width: 701px) {
		:global(.workspace:has(.project-status-bar)) {
			grid-template-rows: minmax(0, 1fr) auto;
		}
	}
	@media (max-width: 700px) {
		:global(.workspace:has(.project-status-bar)) {
			--project-status-height: 44px;
			padding-bottom: calc(var(--project-status-height) + env(safe-area-inset-bottom, 0px));
		}
		.project-status-bar {
			position: absolute;
			z-index: 50;
			inset: auto 0 0;
		}
	}
</style>
