<script lang="ts">
	import { onMount } from 'svelte';
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
		previewUrl
	}: { projectId: string; projectName: string; color: string | null; previewUrl: string } =
		$props();
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
	class="project-status-bar flex min-w-0 items-center overflow-x-auto text-[11px] whitespace-nowrap"
	style={color
		? `--project-status-color: ${color}; --project-status-foreground: ${projectColorForeground(color)}`
		: undefined}
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
				class:bg-[var(--success)]={check.status === 'ready'}
				class:bg-[var(--warning)]={check.status === 'idle'}
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
			padding-bottom: calc(var(--project-status-height) + env(safe-area-inset-bottom, 0px));
		}
		.project-status-bar {
			position: absolute;
			z-index: 50;
			inset: auto 0 0;
		}
	}
</style>
