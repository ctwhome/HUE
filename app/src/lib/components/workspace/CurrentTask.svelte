<script lang="ts">
	import { Check, ChevronDown, Circle, CircleDot } from 'lucide-svelte';
	import { selectTaskSummary, type WorkspacePlanEntry } from '$lib';

	let { plan }: { plan: WorkspacePlanEntry[] } = $props();
	let tasksExpanded = $state(false);
	let summary = $derived(selectTaskSummary(plan));
</script>

{#if summary}<section class="current-task" aria-label="Current task plan">
		<button
			type="button"
			aria-label={`Current task: ${summary.entry.content}`}
			aria-expanded={tasksExpanded}
			onclick={() => (tasksExpanded = !tasksExpanded)}
		>
			{#if summary.entry.status === 'completed'}<Check
					size={15}
					aria-hidden="true"
				/>{:else if summary.entry.status === 'in_progress'}<CircleDot
					size={15}
					aria-hidden="true"
				/>{:else}<Circle size={15} aria-hidden="true" />{/if}
			<span class="task-label"
				><small>Current task</small><strong>{summary.entry.content}</strong></span
			>
			<span class="task-progress">{summary.completed} of {summary.total}</span>
			<ChevronDown class={tasksExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
		</button>
		{#if tasksExpanded}<div class="current-task-entries">
				<progress value={summary.completed} max={summary.total}
					>{summary.completed} of {summary.total}</progress
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
			</div>{/if}
	</section>{/if}
