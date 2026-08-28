<script lang="ts">
	import ArrowDown from '~icons/lucide/arrow-down';
	import ListTodo from '~icons/lucide/list-todo';
	import { selectTaskSummary, type WorkspacePlanEntry } from '$lib';
	import { LatestFollow } from './latest-follow.svelte';

	let {
		plan,
		open = $bindable(false),
		onopen = () => {}
	}: { plan: WorkspacePlanEntry[]; open?: boolean; onopen?: () => void } = $props();
	const latest = new LatestFollow();
	const followLatest = latest.followLatest;
	let summary = $derived(selectTaskSummary(plan));
	let status = $derived(
		summary?.entry.status === 'in_progress'
			? 'In progress'
			: summary?.entry.status === 'completed'
				? 'Complete'
				: 'Pending'
	);

	function toggle() {
		if (!open) onopen();
		open = !open;
	}
	$effect(() => {
		if (!summary) open = false;
	});
</script>

{#snippet entries()}
	<div class="latest-follow-shell">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="current-task-entries" tabindex="0" use:followLatest>
			<div class="latest-follow-content">
				<strong>{summary!.entry.content}</strong>
				<progress value={summary!.completed} max={summary!.total}
					>{summary!.completed} of {summary!.total}</progress
				>
				<ul>
					{#each plan as entry}<li class:completed={entry.status === 'completed'}>
							<span aria-hidden="true"
								>{entry.status === 'completed'
									? '✓'
									: entry.status === 'in_progress'
										? '◉'
										: '○'}</span
							>
							<span>{entry.content}</span><small>{entry.status.replace('_', ' ')}</small>
						</li>{/each}
				</ul>
			</div>
		</div>
		{#if latest.showLatest}<button
				type="button"
				class="panel-scroll-latest"
				aria-label="Scroll to latest task"
				title="Scroll to latest task"
				onclick={() => latest.scrollToLatest()}
				><ArrowDown width={16} height={16} aria-hidden="true" /></button
			>{/if}
	</div>
{/snippet}

{#if summary}<section class="current-task" aria-label="Current task plan">
		<button
			type="button"
			class="task-trigger"
			aria-label="Tasks"
			aria-expanded={open}
			title={`Tasks · ${status} · ${summary.completed}/${summary.total}`}
			onclick={toggle}
		>
			<ListTodo width={16} height={16} aria-hidden="true" />
			<span class="sr-only">Tasks</span>
		</button>
	</section>
	{#if open}{@render entries()}{/if}{/if}
