<script lang="ts">
	import { Archive, Copy, MoreHorizontal, Pencil, Play, RotateCcw, Trash2, X } from 'lucide-svelte';
	import type { WorkMode } from '$lib/work-mode';
	import type { Workflow } from './types';

	let {
		id,
		dialog = $bindable(),
		loading,
		projectName,
		workflows,
		name = $bindable(),
		prompt = $bindable(),
		profile = $bindable(),
		workMode = $bindable(),
		onsubmit,
		onupdate,
		ondelete,
		onduplicate,
		onload,
		onrun
	}: {
		id: string;
		dialog?: HTMLDialogElement;
		loading: boolean;
		projectName: string;
		workflows: Workflow[];
		name: string;
		prompt: string;
		profile: string;
		workMode: WorkMode;
		onsubmit: (event: SubmitEvent) => void;
		onupdate: (
			workflow: Workflow,
			patch: Partial<Pick<Workflow, 'name' | 'prompt' | 'profile' | 'workMode' | 'archived'>>
		) => Promise<boolean>;
		ondelete: (workflow: Workflow) => Promise<boolean>;
		onduplicate: (workflow: Workflow) => Promise<boolean>;
		onload: (includeArchived?: boolean) => Promise<void>;
		onrun: (workflow: Workflow) => void;
	} = $props();
	let editing = $state<Workflow | null>(null);
	let editName = $state('');
	let editPrompt = $state('');
	let editProfile = $state('default');
	let editWorkMode = $state<WorkMode>('autonomous');
	let showArchived = $state(false);
	let launching = $state<Workflow | null>(null);
	let actions = $state<string | null>(null);

	function run(workflow: Workflow) {
		launching = workflow;
	}
	function start() {
		if (!launching) return;
		const workflow = launching;
		launching = null;
		dialog?.close();
		onrun(workflow);
	}
	function edit(workflow: Workflow) {
		editing = workflow;
		editName = workflow.name;
		editPrompt = workflow.prompt;
		editProfile = workflow.profile;
		editWorkMode = workflow.workMode;
	}
	async function saveEdit(event: SubmitEvent) {
		event.preventDefault();
		if (
			editing &&
			(await onupdate(editing, {
				name: editName,
				prompt: editPrompt,
				profile: editProfile,
				workMode: editWorkMode
			}))
		)
			editing = null;
	}
	async function remove(workflow: Workflow) {
		if (window.prompt(`Type ${workflow.name} to delete this Workflow`) === workflow.name)
			await ondelete(workflow);
	}
	async function toggleArchived() {
		showArchived = !showArchived;
		await onload(showArchived);
	}
	function closeActions() {
		actions = null;
	}
	function closeActionsOnEscape(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		closeActions();
		(event.currentTarget as HTMLElement)
			.closest('.workflow-actions')
			?.querySelector('button')
			?.focus();
	}
</script>

<dialog
	bind:this={dialog}
	class="add-project-dialog prompt-library-dialog fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
	aria-labelledby={id}
	onclick={(event) => event.target === event.currentTarget && dialog?.close()}
>
	<header class="dialog-header">
		<div>
			<h2 {id}>Prompt library</h2>
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
			<button type="button" class="justify-self-start" onclick={toggleArchived}
				>{showArchived ? 'Hide archived' : 'Show archived'}</button
			>
			{#if launching}<section
					class="grid gap-2 rounded-xl border border-primary/50 bg-primary/10 p-3"
					aria-label="Workflow launch preview"
				>
					<strong>Launch {launching.name}</strong>
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
						<dt>Project</dt>
						<dd>{projectName}</dd>
						<dt>Profile</dt>
						<dd>{launching.profile}</dd>
						<dt>Work mode</dt>
						<dd>{launching.workMode === 'live' ? 'Live' : 'Autonomous'}</dd>
					</dl>
					<p class="max-h-28 overflow-auto text-sm whitespace-pre-wrap">{launching.prompt}</p>
					<div class="flex gap-2">
						<button type="button" onclick={start}>Start new Session</button><button
							type="button"
							onclick={() => (launching = null)}>Cancel</button
						>
					</div>
				</section>{/if}
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
				{#each workflows.filter((workflow) => showArchived || !workflow.archived) as workflow (workflow.id)}
					<article
						class="workflow-card flex items-start gap-2.5 rounded-xl border border-border bg-card p-3"
					>
						<div class="min-w-0 flex-1">
							<strong>{workflow.name}</strong>
							<p>{workflow.prompt}</p>
							<small class="text-muted-foreground"
								>{projectName} · {workflow.profile} · {workflow.workMode === 'live'
									? 'Live'
									: 'Autonomous'}{workflow.archived ? ' · Archived' : ''}</small
							>
						</div>
						<div class="flex shrink-0 items-start gap-1">
							{#if !workflow.archived}<button
									type="button"
									class="inline-flex items-center gap-1.5"
									aria-label={`Run ${workflow.name}`}
									onclick={() => run(workflow)}><Play size={15} aria-hidden="true" />Run</button
								>{/if}
							<div class="workflow-actions relative">
								<button
									type="button"
									class="grid size-11 cursor-pointer list-none place-items-center rounded-md bg-secondary"
									aria-label={`More actions for ${workflow.name}`}
									aria-expanded={actions === workflow.id}
									onclick={() => (actions = actions === workflow.id ? null : workflow.id)}
									onkeydown={closeActionsOnEscape}
									title="Workflow actions"><MoreHorizontal size={17} aria-hidden="true" /></button
								>
								{#if actions === workflow.id}<div
										class="absolute top-full right-0 z-10 mt-1 grid min-w-44 gap-1 rounded-lg border border-border bg-card p-1 shadow-xl"
										role="menu"
										tabindex="-1"
										onkeydown={closeActionsOnEscape}
									>
										<button
											type="button"
											role="menuitem"
											class="flex items-center gap-2 whitespace-nowrap"
											onclick={(event) => {
												closeActions();
												edit(workflow);
											}}><Pencil size={15} aria-hidden="true" />Edit Workflow</button
										>
										<button
											type="button"
											role="menuitem"
											class="flex items-center gap-2 whitespace-nowrap"
											onclick={(event) => {
												closeActions();
												void onduplicate(workflow);
											}}><Copy size={15} aria-hidden="true" />Duplicate Workflow</button
										>
										<button
											type="button"
											role="menuitem"
											class="flex items-center gap-2 whitespace-nowrap"
											onclick={(event) => {
												closeActions();
												void onupdate(workflow, { archived: !workflow.archived });
											}}
											>{#if workflow.archived}<RotateCcw size={15} aria-hidden="true" />Restore
												Workflow{:else}<Archive size={15} aria-hidden="true" />Archive Workflow{/if}</button
										>
										<button
											type="button"
											class="flex items-center gap-2 whitespace-nowrap text-destructive"
											role="menuitem"
											onclick={(event) => {
												closeActions();
												void remove(workflow);
											}}><Trash2 size={15} aria-hidden="true" />Delete Workflow</button
										>
									</div>{/if}
							</div>
						</div>
					</article>
				{/each}
			{/if}
		</section>
		{#if editing}<form class="workflow-form grid content-start gap-2" onsubmit={saveEdit}>
				<h3 class="text-sm font-semibold">Edit Workflow</h3>
				<label class="grid gap-1 text-sm"
					><span>Name</span><input bind:value={editName} required /></label
				>
				<label class="grid gap-1 text-sm"
					><span>Instructions for Hermes</span><textarea bind:value={editPrompt} required
					></textarea></label
				>
				<label class="grid gap-1 text-sm"
					><span>Hermes profile</span><input bind:value={editProfile} required /></label
				>
				<label class="grid gap-1 text-sm"
					><span>Work mode</span><select bind:value={editWorkMode}
						><option value="autonomous">Autonomous</option><option value="live">Live</option
						></select
					></label
				>
				<div class="flex gap-2">
					<button type="submit">Save Workflow</button><button
						type="button"
						onclick={() => (editing = null)}>Cancel</button
					>
				</div>
			</form>{:else}<form class="workflow-form grid content-start gap-2" {onsubmit}>
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
				<label class="grid gap-1 text-sm"
					><span>Hermes profile</span><input bind:value={profile} required /></label
				>
				<label class="grid gap-1 text-sm"
					><span>Work mode</span><select bind:value={workMode}
						><option value="autonomous">Autonomous</option><option value="live">Live</option
						></select
					></label
				>
				<button type="submit" title="Save prompt">Save prompt</button>
			</form>{/if}
	</div>
</dialog>
