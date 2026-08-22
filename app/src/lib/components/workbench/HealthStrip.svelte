<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw } from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import { api } from './api';

	type Check = {
		id: string;
		label: string;
		status: 'ready' | 'idle' | 'blocked' | 'unavailable';
		summary: string;
		action: string;
	};

	let { projectId, previewUrl }: { projectId: string; previewUrl: string } = $props();
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

	onMount(() => void load());
</script>

<section
	class="flex min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-2.5 py-2"
	aria-label="Runtime health"
>
	{#each visibleChecks as check}
		<div
			class="grid min-h-11 shrink-0 grid-cols-[auto_auto_auto] items-center gap-x-1.5 rounded-md border border-border px-2 py-1 text-xs"
			data-health-id={check.id}
			aria-label={`${check.label}: ${check.summary}. ${check.action}`}
			title={`${check.summary}. ${check.action}`}
		>
			<span
				class="size-2 rounded-full"
				aria-hidden="true"
				class:bg-emerald-400={check.status === 'ready'}
				class:bg-amber-400={check.status === 'idle'}
				class:bg-destructive={check.status === 'blocked' || check.status === 'unavailable'}
			></span>
			<strong>{check.label}</strong><span class="text-muted-foreground">{check.summary}</span>
			<small class="col-span-2 col-start-2 text-muted-foreground">{check.action}</small>
		</div>
	{/each}
	{#if error}<span class="text-xs text-destructive" role="alert">Health unavailable: {error}</span
		>{/if}
	<Button
		variant="ghost"
		size="icon"
		class="ml-auto size-11 shrink-0 min-[701px]:size-8"
		aria-label="Refresh runtime health"
		title="Refresh runtime health"
		disabled={loading}
		onclick={load}><RefreshCw size={14} aria-hidden="true" /></Button
	>
</section>
