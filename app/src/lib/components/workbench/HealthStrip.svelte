<script lang="ts">
	import { onMount } from 'svelte';
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
		previewUrl
	}: { projectId: string; projectName: string; previewUrl: string } = $props();
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
	let cancelInitialLoad: (() => void) | null = null;
	let visibleChecks = $derived(
		checks.map((check) =>
			check.id === 'preview'
				? {
						...check,
						status: previewUrl ? ('ready' as const) : ('idle' as const),
						summary: previewUrl ? new URL(previewUrl).host : 'No saved address',
						action: previewUrl ? 'Preview saved in Browser panel' : 'Enter address in Browser panel'
					}
				: check
		)
	);

	async function load() {
		cancelInitialLoad?.();
		cancelInitialLoad = null;
		if (loading) return;
		loading = true;
		error = '';
		try {
			checks = (
				await api<{ checks: Check[] }>(`/api/health?projectId=${encodeURIComponent(projectId)}`)
			).checks;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		cancelInitialLoad = afterInitialPaint(() => void load());
		return () => cancelInitialLoad?.();
	});
</script>

<section
	class="project-status-bar absolute inset-x-0 bottom-0 z-50 flex min-w-0 items-center overflow-x-auto border-t border-border bg-card text-[11px] whitespace-nowrap"
	aria-label="Runtime health"
	aria-busy={loading}
>
	<strong class="shrink-0 border-r border-border px-2.5">{projectName}</strong>
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
				class:bg-emerald-400={check.status === 'ready'}
				class:bg-amber-400={check.status === 'idle'}
				class:bg-destructive={check.status === 'blocked' || check.status === 'unavailable'}
			></span>
			<strong>{check.label}</strong><span class="text-muted-foreground">{check.summary}</span>
		</div>
	{/each}
	{#if error}<span class="px-2 text-destructive" role="alert">Health unavailable: {error}</span
		>{/if}
</section>

<style>
	:global(.workspace:has(.project-status-bar)) {
		--project-status-height: 28px;
		padding-bottom: calc(var(--project-status-height) + env(safe-area-inset-bottom, 0px));
	}
	.project-status-bar {
		height: calc(var(--project-status-height) + env(safe-area-inset-bottom, 0px));
		padding-bottom: env(safe-area-inset-bottom, 0px);
		scrollbar-width: none;
	}
	.project-status-bar::-webkit-scrollbar {
		display: none;
	}
</style>
