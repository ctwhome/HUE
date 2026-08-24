<script lang="ts">
	import { X } from 'lucide-svelte';
	import type { Workflow } from './types';

	let {
		dialog = $bindable(),
		loading,
		workflows,
		name = $bindable(),
		prompt = $bindable(),
		onsubmit,
		onrun
	}: {
		dialog?: HTMLDialogElement;
		loading: boolean;
		workflows: Workflow[];
		name: string;
		prompt: string;
		onsubmit: (event: SubmitEvent) => void;
		onrun: (workflow: Workflow) => void;
	} = $props();

	function run(workflow: Workflow) {
		dialog?.close();
		onrun(workflow);
	}
</script>

<dialog
	bind:this={dialog}
	class="add-project-dialog prompt-library-dialog fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
	aria-labelledby="prompt-library-title"
	onclick={(event) => event.target === event.currentTarget && dialog?.close()}
>
	<header class="dialog-header">
		<div>
			<h2 id="prompt-library-title">Prompt library</h2>
			<p>Repeat a Hermes task without rewriting its instructions.</p>
		</div>
		<button
			class="icon-button absolute top-3 right-3 grid size-8 place-items-center rounded-md border border-border bg-secondary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="Close prompt library"
			title="Close prompt library"
			onclick={() => dialog?.close()}><X size={18} aria-hidden="true" /></button
		>
	</header>
	<div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
		<section class="grid content-start gap-2" aria-label="Saved prompts">
			<p class="text-sm text-muted-foreground">
				Run creates a new Session and sends the saved instructions to Hermes.
			</p>
			{#if loading}<p class="p-4 text-center text-sm text-muted-foreground" role="status">
					Loading prompts…
				</p>
			{:else if workflows.length === 0}<div
					class="rounded-xl border border-dashed border-border p-4 text-center"
				>
					<h3 class="font-medium">No prompts yet</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						Create one for recurring work such as running checks or preparing a release.
					</p>
				</div>
			{:else}
				{#each workflows as workflow (workflow.id)}
					<article
						class="workflow-card flex items-start gap-2.5 rounded-xl border border-border bg-card p-3"
					>
						<div>
							<strong>{workflow.name}</strong>
							<p>{workflow.prompt}</p>
						</div>
						<button
							type="button"
							aria-label={`Run ${workflow.name}`}
							title={`Run ${workflow.name}`}
							onclick={() => run(workflow)}>Run</button
						>
					</article>
				{/each}
			{/if}
		</section>
		<form class="workflow-form grid content-start gap-2" {onsubmit}>
			<h3 class="text-sm font-semibold">Create prompt</h3>
			<label class="grid gap-1 text-sm"
				><span>Name</span><input
					bind:value={name}
					placeholder="Prepare release"
					aria-label="Workflow name"
					required
				/></label
			>
			<label class="grid gap-1 text-sm"
				><span>Instructions for Hermes</span><textarea
					bind:value={prompt}
					placeholder="Describe the task Hermes should run"
					aria-label="Workflow prompt"
					required></textarea></label
			>
			<button type="submit" title="Save prompt">Save prompt</button>
		</form>
	</div>
</dialog>
