<script lang="ts">
	import Archive from '~icons/lucide/archive';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Copy from '~icons/lucide/copy';
	import Folder from '~icons/lucide/folder';
	import FolderPlus from '~icons/lucide/folder-plus';
	import MoreHorizontal from '~icons/lucide/more-horizontal';
	import Pencil from '~icons/lucide/pencil';
	import Plus from '~icons/lucide/plus';
	import RotateCcw from '~icons/lucide/rotate-ccw';
	import Search from '~icons/lucide/search';
	import Star from '~icons/lucide/star';
	import Trash2 from '~icons/lucide/trash-2';
	import X from '~icons/lucide/x';
	import { groupPromptCatalog, loadPromptCatalog, type CatalogPrompt } from '$lib/prompt-catalog';
	import type { WorkMode } from '$lib/work-mode';
	import type { Workflow } from './types';

	let {
		id,
		dialog = $bindable(),
		loading,
		available,
		projectName,
		workflows,
		name = $bindable(),
		prompt = $bindable(),
		folder = $bindable(),
		profile = $bindable(),
		workMode = $bindable(),
		onsubmit,
		onupdate,
		ondelete,
		onduplicate,
		onfavoritecatalog,
		onload,
		oninsert
	}: {
		id: string;
		dialog?: HTMLDialogElement;
		loading: boolean;
		available: boolean;
		projectName: string;
		workflows: Workflow[];
		name: string;
		prompt: string;
		folder: string;
		profile: string;
		workMode: WorkMode;
		onsubmit: (event: SubmitEvent) => boolean | void | Promise<boolean | void>;
		onupdate: (
			workflow: Workflow,
			patch: Partial<
				Pick<
					Workflow,
					'name' | 'prompt' | 'folder' | 'favorite' | 'profile' | 'workMode' | 'archived'
				>
			>
		) => Promise<boolean>;
		ondelete: (workflow: Workflow) => Promise<boolean>;
		onduplicate: (workflow: Workflow) => Promise<boolean>;
		onfavoritecatalog: (prompt: CatalogPrompt) => Promise<boolean>;
		onload: (includeArchived?: boolean) => Promise<void>;
		oninsert: (workflow: Workflow) => void;
	} = $props();

	let source = $state<'prompts' | 'community'>('prompts');
	let query = $state('');
	let catalog = $state<CatalogPrompt[]>([]);
	let catalogLoading = $state(false);
	let catalogError = $state('');
	let selectedCatalogId = $state<string | null>(null);
	let selectedWorkflowId = $state<string | null>(null);
	let editor = $state<'create' | 'edit' | null>(null);
	let editing = $state<Workflow | null>(null);
	let editName = $state('');
	let editPrompt = $state('');
	let editFolder = $state('');
	let editProfile = $state('default');
	let editWorkMode = $state<WorkMode>('autonomous');
	let showArchived = $state(false);
	let actions = $state(false);
	let mobileDetail = $state(false);

	let normalizedQuery = $derived(query.trim().toLowerCase());
	let catalogGroups = $derived(groupPromptCatalog(catalog, query));
	let catalogResults = $derived(catalogGroups.flatMap(({ items }) => items));
	let customResults = $derived(
		workflows.filter(
			(item) =>
				(showArchived || !item.archived) &&
				`${item.name} ${item.folder ?? ''} ${item.prompt}`.toLowerCase().includes(normalizedQuery)
		)
	);
	let selectedCatalog = $derived(
		catalog.find(({ id }) => id === selectedCatalogId) ?? catalogResults[0] ?? null
	);
	let selectedWorkflow = $derived(
		workflows.find(({ id }) => id === selectedWorkflowId) ?? customResults[0] ?? null
	);
	let selectedCatalogWorkflow = $derived(
		selectedCatalog
			? (workflows.find(
					(workflow) =>
						workflow.name === selectedCatalog!.title && workflow.prompt === selectedCatalog!.prompt
				) ?? null)
			: null
	);
	let promptGroups = $derived([
		...(customResults.some((item) => item.favorite)
			? [{ name: 'Favorites', items: customResults.filter((item) => item.favorite) }]
			: []),
		...categories(
			customResults.filter((item) => !item.favorite),
			(item) => item.folder || 'Unfiled'
		).map((name) => ({
			name,
			items: customResults.filter((item) => !item.favorite && (item.folder || 'Unfiled') === name)
		}))
	]);

	function categories<T>(items: T[], getCategory: (item: T) => string) {
		return [...new Set(items.map(getCategory))].sort((a, b) => a.localeCompare(b));
	}
	async function ensureCatalog() {
		if (catalog.length || catalogLoading) return;
		catalogLoading = true;
		catalogError = '';
		try {
			catalog = await loadPromptCatalog();
			selectedCatalogId = catalog[0]?.id ?? null;
		} catch (cause) {
			catalogError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			catalogLoading = false;
		}
	}
	function startCreate(template?: CatalogPrompt) {
		name = template?.title ?? '';
		prompt = template?.prompt ?? '';
		folder = template?.category ?? '';
		editor = 'create';
		mobileDetail = true;
		editing = null;
	}
	function addFolder() {
		const value = window.prompt('Folder name')?.trim();
		if (!value) return;
		startCreate();
		folder = value.slice(0, 100);
	}
	function startEdit(workflow: Workflow) {
		editing = workflow;
		editName = workflow.name;
		editPrompt = workflow.prompt;
		editFolder = workflow.folder ?? '';
		editProfile = workflow.profile;
		editWorkMode = workflow.workMode;
		editor = 'edit';
		mobileDetail = true;
		actions = false;
	}
	async function saveEdit(event: SubmitEvent) {
		event.preventDefault();
		if (
			editing &&
			(await onupdate(editing, {
				name: editName,
				prompt: editPrompt,
				folder: editFolder.trim() || null,
				profile: editProfile,
				workMode: editWorkMode
			}))
		)
			editor = null;
	}
	async function saveCreate(event: SubmitEvent) {
		if ((await onsubmit(event)) === true) {
			editor = null;
			source = 'prompts';
		}
	}
	async function toggleCatalogFavorite(item: CatalogPrompt) {
		const existing = workflows.find(
			(workflow) => workflow.name === item.title && workflow.prompt === item.prompt
		);
		if (existing) await onupdate(existing, { favorite: !existing.favorite });
		else await onfavoritecatalog(item);
	}
	async function remove(workflow: Workflow) {
		actions = false;
		if (window.prompt(`Type ${workflow.name} to delete this Workflow`) === workflow.name) {
			await ondelete(workflow);
			selectedWorkflowId = null;
		}
	}
	async function toggleArchived() {
		showArchived = !showArchived;
		await onload(showArchived);
	}
	function closeActionsOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape' && actions) {
			event.preventDefault();
			event.stopPropagation();
			actions = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="prompt-library-dialog fixed top-1/2 left-1/2 m-0 h-[min(760px,calc(100dvh-32px))] w-[min(1080px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60"
	aria-labelledby={id}
	onclick={(event) => event.target === event.currentTarget && dialog?.close()}
	onfocusin={() => void ensureCatalog()}
	onclose={() => {
		mobileDetail = false;
		editor = null;
		actions = false;
	}}
>
	<header class="flex min-h-20 items-center justify-between gap-4 border-b border-border px-5 py-4">
		<div>
			<h2 {id} class="text-lg font-semibold">Prompt library</h2>
			<p class="text-sm text-muted-foreground">
				Find a proven starting point or organize reusable prompts for {projectName ||
					'your Project'}.
			</p>
		</div>
		<button
			class="grid size-11 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent"
			aria-label="Close prompt library"
			title="Close prompt library"
			onclick={() => dialog?.close()}><X width={18} height={18} aria-hidden="true" /></button
		>
	</header>
	{#if !available}<p
			class="m-5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground"
		>
			Select a Project to use its prompt library.
		</p>{:else}
		<div class="grid h-[calc(100%-80px)] min-h-0 grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
			<aside
				class={`${mobileDetail ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-b border-border md:border-r md:border-b-0`}
				aria-label="Prompt list"
			>
				<div class="grid gap-3 border-b border-border p-3">
					<div
						class="grid grid-cols-2 rounded-lg bg-muted p-1"
						role="tablist"
						aria-label="Prompt sources"
					>
						<button
							type="button"
							role="tab"
							aria-selected={source === 'prompts'}
							class:bg-card={source === 'prompts'}
							onclick={() => {
								source = 'prompts';
								editor = null;
								mobileDetail = false;
							}}
							>Prompts <span class="text-muted-foreground"
								>{workflows.filter((item) => !item.archived).length}</span
							></button
						>
						<button
							type="button"
							role="tab"
							aria-selected={source === 'community'}
							class:bg-card={source === 'community'}
							onclick={() => {
								source = 'community';
								editor = null;
								mobileDetail = false;
							}}
							>Community <span class="text-muted-foreground"
								>{catalog.length ? catalog.length.toLocaleString() : ''}</span
							></button
						>
					</div>
					<label
						class="flex min-h-11 items-center gap-2 rounded-lg border border-input bg-background px-3"
						><Search width={17} height={17} aria-hidden="true" /><span class="sr-only"
							>Search prompts</span
						><input
							class="min-w-0 flex-1 border-0 bg-transparent outline-none"
							bind:value={query}
							placeholder="Search prompts…"
						/></label
					>
					{#if source === 'prompts'}<div class="flex items-center justify-between gap-2">
							<button
								type="button"
								class="inline-flex min-h-11 items-center gap-2"
								onclick={() => startCreate()}
								><Plus width={16} height={16} aria-hidden="true" />New custom</button
							>
							<div class="flex items-center gap-1">
								<button
									type="button"
									class="grid size-11 place-items-center"
									aria-label="Add folder"
									title="Add folder"
									onclick={addFolder}
									><FolderPlus width={17} height={17} aria-hidden="true" /></button
								><button type="button" onclick={toggleArchived}
									>{showArchived ? 'Hide archived' : 'Show archived'}</button
								>
							</div>
						</div>{/if}
				</div>
				<nav
					class="min-h-0 flex-1 overflow-y-auto p-2"
					aria-label={source === 'community' ? 'Community prompts' : 'Prompts'}
				>
					{#if loading && source === 'prompts'}<p
							class="p-4 text-center text-sm text-muted-foreground"
							role="status"
						>
							Loading prompts…
						</p>
					{:else if source === 'community'}
						{#if catalogLoading}<p
								class="p-4 text-center text-sm text-muted-foreground"
								role="status"
							>
								Loading complete catalog…
							</p>
						{:else if catalogError}<p class="p-4 text-center text-sm text-destructive" role="alert">
								{catalogError}
							</p>
						{:else}{#each catalogGroups as group}<details
									class="group mb-3"
									open={Boolean(normalizedQuery)}
								>
									<summary
										class="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:bg-accent"
									>
										<ChevronRight
											class="transition-transform group-open:rotate-90"
											width={14}
											height={14}
											aria-hidden="true"
										/><Folder width={14} height={14} aria-hidden="true" />{group.category}
									</summary>
									{#each group.items as item (item.id)}<button
											type="button"
											class="mb-1 grid min-h-12 w-full gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-accent"
											class:bg-accent={selectedCatalog?.id === item.id}
											aria-pressed={selectedCatalog?.id === item.id}
											onclick={() => {
												selectedCatalogId = item.id;
												editor = null;
												mobileDetail = true;
											}}
											><strong class="truncate text-sm">{item.title}</strong><span
												class="truncate text-xs text-muted-foreground">{item.description}</span
											></button
										>{/each}
								</details>{/each}{/if}
					{:else if promptGroups.length}
						{#each promptGroups as group}<details
								class="group mb-3"
								open={Boolean(normalizedQuery)}
							>
								<summary
									class="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:bg-accent"
								>
									<ChevronRight
										class="transition-transform group-open:rotate-90"
										width={14}
										height={14}
										aria-hidden="true"
									/>{#if group.name === 'Favorites'}<Star
											width={14}
											height={14}
											fill="currentColor"
											aria-hidden="true"
										/>{:else}<Folder width={14} height={14} aria-hidden="true" />{/if}{group.name}
								</summary>
								{#each group.items as item (item.id)}<button
										type="button"
										class="mb-1 grid min-h-12 w-full gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-accent"
										class:bg-accent={selectedWorkflow?.id === item.id}
										aria-pressed={selectedWorkflow?.id === item.id}
										onclick={() => {
											selectedWorkflowId = item.id;
											editor = null;
											mobileDetail = true;
										}}
										><strong class="truncate text-sm">{item.name}</strong><span
											class="truncate text-xs text-muted-foreground"
											>{item.archived ? 'Archived · ' : ''}{item.profile} · {item.workMode}</span
										></button
									>{/each}
							</details>{/each}
					{:else}<p class="p-5 text-center text-sm text-muted-foreground">
							{query ? 'No matching prompts.' : 'No custom prompts yet.'}
						</p>{/if}
				</nav>
				<p class="border-t border-border p-3 text-xs text-muted-foreground">
					Open catalog curated from <a
						class="underline"
						href="https://github.com/f/prompts.chat"
						target="_blank"
						rel="noreferrer">prompts.chat</a
					> · CC0
				</p>
			</aside>

			<section
				class={`${mobileDetail ? 'block' : 'hidden md:block'} min-h-0 overflow-y-auto p-5`}
				aria-label="Prompt preview"
			>
				<button
					type="button"
					class="mb-4 min-h-11 md:hidden"
					onclick={() => {
						mobileDetail = false;
						editor = null;
					}}>Back to prompts</button
				>
				{#if editor === 'create'}
					<form
						class="workflow-form mx-auto grid max-w-2xl content-start gap-3"
						onsubmit={saveCreate}
					>
						<div class="flex items-center justify-between">
							<h3 class="text-base font-semibold">Add custom prompt</h3>
							<button type="button" onclick={() => (editor = null)}>Cancel</button>
						</div>
						<label class="grid gap-1 text-sm"
							><span>Name</span><input
								bind:value={name}
								aria-label="Workflow name"
								required
							/></label
						><label class="grid gap-1 text-sm"
							><span>Folder</span><input
								bind:value={folder}
								list={`${id}-folders`}
								placeholder="Unfiled"
								maxlength="100"
							/></label
						><datalist id={`${id}-folders`}
							>{#each categories(workflows, (item) => item.folder || 'Unfiled').filter((item) => item !== 'Unfiled') as item}<option
									value={item}
								></option>{/each}</datalist
						><label class="grid gap-1 text-sm"
							><span>Instructions for Hermes</span><textarea
								class="min-h-56"
								bind:value={prompt}
								aria-label="Workflow prompt"
								required></textarea></label
						>
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="grid gap-1 text-sm"
								><span>Hermes profile</span><input bind:value={profile} required /></label
							><label class="grid gap-1 text-sm"
								><span>Work mode</span><select bind:value={workMode}
									><option value="autonomous">Autonomous</option><option value="live">Live</option
									></select
								></label
							>
						</div>
						<button type="submit" title="Save prompt">Add prompt</button>
					</form>
				{:else if editor === 'edit' && editing}
					<form
						class="workflow-form mx-auto grid max-w-2xl content-start gap-3"
						onsubmit={saveEdit}
					>
						<div class="flex items-center justify-between">
							<h3 class="text-base font-semibold">Edit custom prompt</h3>
							<button type="button" onclick={() => (editor = null)}>Cancel</button>
						</div>
						<label class="grid gap-1 text-sm"
							><span>Name</span><input bind:value={editName} required /></label
						><label class="grid gap-1 text-sm"
							><span>Folder</span><input
								bind:value={editFolder}
								placeholder="Unfiled"
								maxlength="100"
							/></label
						><label class="grid gap-1 text-sm"
							><span>Instructions for Hermes</span><textarea
								class="min-h-56"
								bind:value={editPrompt}
								required></textarea></label
						>
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="grid gap-1 text-sm"
								><span>Hermes profile</span><input bind:value={editProfile} required /></label
							><label class="grid gap-1 text-sm"
								><span>Work mode</span><select bind:value={editWorkMode}
									><option value="autonomous">Autonomous</option><option value="live">Live</option
									></select
								></label
							>
						</div>
						<button type="submit">Save prompt</button>
					</form>
				{:else if source === 'community' && selectedCatalog}
					<article class="mx-auto grid max-w-2xl gap-5">
						<div class="flex items-start justify-between gap-4">
							<div>
								<span class="text-xs font-semibold tracking-wide text-primary uppercase"
									>{selectedCatalog.category}</span
								>
								<h3 class="mt-1 text-xl font-semibold">{selectedCatalog.title}</h3>
								<p class="mt-1 text-sm text-muted-foreground">{selectedCatalog.description}</p>
							</div>
							<button
								type="button"
								class="grid size-11 shrink-0 place-items-center rounded-md bg-secondary"
								aria-label={selectedCatalogWorkflow?.favorite
									? 'Remove from favorites'
									: 'Add to favorites'}
								title={selectedCatalogWorkflow?.favorite
									? 'Remove from favorites'
									: 'Add to favorites'}
								onclick={() => toggleCatalogFavorite(selectedCatalog)}
								><Star
									width={19}
									height={19}
									fill={selectedCatalogWorkflow?.favorite ? 'currentColor' : 'none'}
									aria-hidden="true"
								/></button
							>
						</div>
						<div class="rounded-xl border border-border bg-background p-4">
							<p class="text-sm leading-6 whitespace-pre-wrap">{selectedCatalog.prompt}</p>
						</div>
						<button
							type="button"
							class="inline-flex min-h-11 w-fit items-center gap-2"
							onclick={() => startCreate(selectedCatalog)}
							><Plus width={17} height={17} aria-hidden="true" />Add to custom prompts</button
						>
					</article>
				{:else if source === 'prompts' && selectedWorkflow}
					<article class="mx-auto grid max-w-2xl gap-5">
						<div class="flex items-start justify-between gap-4">
							<div>
								<span class="text-xs font-semibold tracking-wide text-primary uppercase"
									>{selectedWorkflow.folder || 'Unfiled'}</span
								>
								<h3 class="mt-1 text-xl font-semibold">{selectedWorkflow.name}</h3>
								<p class="mt-1 text-sm text-muted-foreground">
									{projectName} · {selectedWorkflow.profile} · {selectedWorkflow.workMode === 'live'
										? 'Live'
										: 'Autonomous'}{selectedWorkflow.archived ? ' · Archived' : ''}
								</p>
							</div>
							<div class="flex items-center gap-1">
								<button
									type="button"
									class="grid size-11 place-items-center rounded-md bg-secondary"
									aria-label={selectedWorkflow.favorite
										? 'Remove from favorites'
										: 'Add to favorites'}
									title={selectedWorkflow.favorite ? 'Remove from favorites' : 'Add to favorites'}
									onclick={() =>
										onupdate(selectedWorkflow, { favorite: !selectedWorkflow.favorite })}
									><Star
										width={18}
										height={18}
										fill={selectedWorkflow.favorite ? 'currentColor' : 'none'}
										aria-hidden="true"
									/></button
								>
								<div class="relative">
									<button
										type="button"
										class="grid size-11 place-items-center rounded-md bg-secondary"
										aria-label={`More actions for ${selectedWorkflow.name}`}
										aria-expanded={actions}
										onclick={() => (actions = !actions)}
										onkeydown={closeActionsOnEscape}
										title="Workflow actions"
										><MoreHorizontal width={17} height={17} aria-hidden="true" /></button
									>{#if actions}<div
											class="absolute top-full right-0 z-10 mt-1 grid min-w-48 gap-1 rounded-lg border border-border bg-card p-1 shadow-xl"
											role="menu"
											tabindex="-1"
											onkeydown={closeActionsOnEscape}
										>
											<button
												type="button"
												role="menuitem"
												class="flex items-center gap-2"
												onclick={() => startEdit(selectedWorkflow)}
												><Pencil width={15} height={15} aria-hidden="true" />Edit Workflow</button
											><button
												type="button"
												role="menuitem"
												class="flex items-center gap-2"
												onclick={() => {
													actions = false;
													void onduplicate(selectedWorkflow);
												}}
												><Copy width={15} height={15} aria-hidden="true" />Duplicate Workflow</button
											><button
												type="button"
												role="menuitem"
												class="flex items-center gap-2"
												onclick={() => {
													actions = false;
													void onupdate(selectedWorkflow, { archived: !selectedWorkflow.archived });
												}}
												>{#if selectedWorkflow.archived}<RotateCcw
														width={15}
														height={15}
														aria-hidden="true"
													/>Restore Workflow{:else}<Archive
														width={15}
														height={15}
														aria-hidden="true"
													/>Archive Workflow{/if}</button
											><button
												type="button"
												role="menuitem"
												class="flex items-center gap-2 text-destructive"
												onclick={() => remove(selectedWorkflow)}
												><Trash2 width={15} height={15} aria-hidden="true" />Delete Workflow</button
											>
										</div>{/if}
								</div>
							</div>
						</div>
						<div class="rounded-xl border border-border bg-background p-4">
							<p class="text-sm leading-6 whitespace-pre-wrap">{selectedWorkflow.prompt}</p>
						</div>
						{#if !selectedWorkflow.archived}<button
								type="button"
								class="inline-flex min-h-11 w-fit items-center gap-2"
								aria-label={`Add ${selectedWorkflow.name} to input`}
								onclick={() => oninsert(selectedWorkflow)}
								><Plus width={16} height={16} aria-hidden="true" />Add to input</button
							>{/if}
					</article>
				{:else}<div
						class="grid min-h-64 place-items-center text-center text-sm text-muted-foreground"
					>
						<p>Select a prompt to preview it.</p>
					</div>{/if}
			</section>
		</div>
	{/if}
</dialog>
