<script lang="ts">
	import { ChevronDown, ListTodo, X } from 'lucide-svelte';
	import { onMount, tick } from 'svelte';
	import { selectTaskSummary, type WorkspacePlanEntry } from '$lib';

	let { plan }: { plan: WorkspacePlanEntry[] } = $props();
	let tasksExpanded = $state(false);
	let mobile = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let trigger = $state<HTMLButtonElement>();
	let summary = $derived(selectTaskSummary(plan));
	let status = $derived(
		summary?.entry.status === 'in_progress'
			? 'In progress'
			: summary?.entry.status === 'completed'
				? 'Complete'
				: 'Pending'
	);

	onMount(() => {
		const media = matchMedia('(max-width: 700px)');
		const update = () => {
			if (mobile !== media.matches) {
				dialog?.close();
				tasksExpanded = false;
			}
			mobile = media.matches;
		};
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	async function toggle() {
		if (!mobile) {
			tasksExpanded = !tasksExpanded;
			return;
		}
		tasksExpanded = true;
		await tick();
		dialog?.showModal();
	}

	async function close() {
		dialog?.close();
		tasksExpanded = false;
		await tick();
		trigger?.focus();
	}
</script>

{#snippet entries()}
	<div class="current-task-entries">
		<strong>{summary!.entry.content}</strong>
		<progress value={summary!.completed} max={summary!.total}
			>{summary!.completed} of {summary!.total}</progress
		>
		<ul>
			{#each plan as entry}<li class:completed={entry.status === 'completed'}>
					<span aria-hidden="true"
						>{entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '◉' : '○'}</span
					>
					<span>{entry.content}</span><small>{entry.status.replace('_', ' ')}</small>
				</li>{/each}
		</ul>
	</div>
{/snippet}

{#if summary}<section class="current-task" aria-label="Current task plan">
		<button
			bind:this={trigger}
			type="button"
			class="task-trigger"
			aria-label="Tasks"
			aria-haspopup={mobile ? 'dialog' : undefined}
			aria-expanded={tasksExpanded}
			onclick={toggle}
		>
			<ListTodo size={16} aria-hidden="true" />
			<span>Tasks</span><small>{status} · {summary.completed}/{summary.total}</small>
			<ChevronDown class={tasksExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
		</button>
		{#if tasksExpanded && !mobile}{@render entries()}{/if}
	</section>{/if}

{#if summary && tasksExpanded && mobile}<dialog
		bind:this={dialog}
		class="task-dialog"
		aria-label="Tasks"
		oncancel={(event) => {
			event.preventDefault();
			void close();
		}}
		onclick={(event) => event.target === dialog && void close()}
	>
		<header>
			<div><ListTodo size={18} aria-hidden="true" /><strong>Tasks</strong><small>{status}</small></div>
			<button type="button" aria-label="Close Tasks" title="Close Tasks" onclick={close}
				><X size={18} aria-hidden="true" /></button
			>
		</header>
		{@render entries()}
	</dialog>{/if}
