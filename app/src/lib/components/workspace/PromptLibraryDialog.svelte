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
	import { workspaceApi } from './api';
	import type { HermesBundle, HermesBundleSkill, Workflow } from './types';

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
		bundle = $bindable(),
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
		bundle: string;
		onsubmit: (event: SubmitEvent) => boolean | void | Promise<boolean | void>;
		onupdate: (
			workflow: Workflow,
			patch: Partial<
				Pick<
					Workflow,
					'name' | 'prompt' | 'folder' | 'favorite' | 'profile' | 'bundle' | 'archived'
				>
			>
		) => Promise<boolean>;
		ondelete: (workflow: Workflow) => Promise<boolean>;
		onduplicate: (workflow: Workflow) => Promise<boolean>;
		onfavoritecatalog: (prompt: CatalogPrompt) => Promise<boolean>;
		onload: (includeArchived?: boolean) => Promise<void>;
		oninsert: (prompt: string) => void;
	} = $props();

	let source = $state<'prompts' | 'community' | 'bundles'>('community');
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
	let editBundle = $state('autonomous');
	let bundles = $state<HermesBundle[]>([]);
	let bundleSkills = $state<HermesBundleSkill[]>([]);
	let bundlesLoading = $state(false);
	let bundleError = $state('');
	let selectedBundleSlug = $state('');
	let creatingBundle = $state(false);
	let bundleName = $state('');
	let bundleDescription = $state('');
	let bundleInstruction = $state('');
	let bundleMembers = $state<string[]>([]);
	let openedSkill = $state('');
	let skillContent = $state('');
	let skillEditable = $state(false);
	let skillProvenance = $state('');
	let skillSaving = $state(false);
	let showArchived = $state(false);
	let actions = $state(false);
	let mobileDetail = $state(false);
	$effect(() => {
		if (!available) source = 'community';
	});

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
	async function ensureBundles(force = false) {
		if ((!force && bundles.length) || bundlesLoading || !available) return;
		bundlesLoading = true;
		bundleError = '';
		try {
			const body = await workspaceApi<{ bundles: HermesBundle[]; skills: HermesBundleSkill[] }>(
				'/api/hermes/bundles'
			);
			bundles = body.bundles;
			bundleSkills = body.skills;
			if (!selectedBundleSlug || !bundles.some(({ slug }) => slug === selectedBundleSlug)) {
				selectBundle(bundles[0] ?? null);
			}
			if (!bundles.some(({ slug }) => slug === bundle)) bundle = bundles[0]?.slug ?? bundle;
		} catch (cause) {
			bundleError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			bundlesLoading = false;
		}
	}
	function selectBundle(item: HermesBundle | null) {
		selectedBundleSlug = item?.slug ?? '';
		bundleName = item?.name ?? '';
		bundleDescription = item?.description ?? '';
		bundleInstruction = item?.instruction ?? '';
		bundleMembers = [...(item?.skills ?? [])];
		creatingBundle = false;
		openedSkill = '';
	}
	function startBundleCreate() {
		selectedBundleSlug = '';
		bundleName = '';
		bundleDescription = '';
		bundleInstruction = '';
		bundleMembers = [];
		creatingBundle = true;
		openedSkill = '';
	}
	function toggleBundleSkill(name: string, included: boolean) {
		bundleMembers = included
			? [...bundleMembers, name]
			: bundleMembers.filter((member) => member !== name);
	}
	async function saveBundle(event: SubmitEvent) {
		event.preventDefault();
		bundleError = '';
		try {
			const body = await workspaceApi<{ bundle: HermesBundle }>(
				creatingBundle
					? '/api/hermes/bundles'
					: `/api/hermes/bundles/${encodeURIComponent(selectedBundleSlug)}`,
				{
					method: creatingBundle ? 'POST' : 'PUT',
					body: JSON.stringify({
						...(creatingBundle ? { name: bundleName } : {}),
						description: bundleDescription,
						skills: bundleMembers,
						instruction: bundleInstruction
					})
				}
			);
			bundles = creatingBundle
				? [...bundles, body.bundle]
				: bundles.map((item) => (item.slug === selectedBundleSlug ? body.bundle : item));
			selectBundle(body.bundle);
			bundle = body.bundle.slug;
		} catch (cause) {
			bundleError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	async function deleteBundle() {
		const selected = bundles.find(({ slug }) => slug === selectedBundleSlug);
		if (!selected || window.prompt(`Type ${selected.name} to delete this Bundle`) !== selected.name)
			return;
		bundleError = '';
		try {
			await workspaceApi(`/api/hermes/bundles/${encodeURIComponent(selected.slug)}`, {
				method: 'DELETE',
				body: JSON.stringify({ confirm: selected.name })
			});
			bundles = bundles.filter((item) => item.slug !== selected.slug);
			selectBundle(bundles[0] ?? null);
			if (bundle === selected.slug) bundle = bundles[0]?.slug ?? '';
		} catch (cause) {
			bundleError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	async function openSkill(name: string) {
		bundleError = '';
		try {
			const body = await workspaceApi<{
				name: string;
				content: string;
				provenance: string;
				editable: boolean;
			}>(`/api/hermes/skills/${encodeURIComponent(name)}`);
			const access = bundleSkills.find((skill) => skill.name === name);
			openedSkill = name;
			skillContent = body.content;
			skillProvenance = body.provenance;
			skillEditable =
				body.editable && access?.permissions.write === true && access.provenance === 'custom';
		} catch (cause) {
			bundleError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	async function saveSkill() {
		if (!openedSkill || !skillEditable) return;
		skillSaving = true;
		bundleError = '';
		try {
			await workspaceApi(`/api/hermes/skills/${encodeURIComponent(openedSkill)}`, {
				method: 'PUT',
				body: JSON.stringify({ content: skillContent })
			});
		} catch (cause) {
			bundleError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			skillSaving = false;
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
		editBundle = workflow.bundle;
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
				bundle: editBundle
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
	onkeydown={closeActionsOnEscape}
	onfocusin={() => {
		void ensureCatalog();
		void ensureBundles();
	}}
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
				Find a proven starting point or organize reusable prompts.
			</p>
		</div>
		<button
			class="grid size-11 shrink-0 place-items-center rounded-md border border-border bg-secondary hover:bg-accent"
			aria-label="Close prompt library"
			title="Close prompt library"
			onclick={() => dialog?.close()}><X width={18} height={18} aria-hidden="true" /></button
		>
	</header>
	<div class="grid h-[calc(100%-80px)] min-h-0 grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
		<aside
			class={`${mobileDetail ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-b border-border md:border-r md:border-b-0`}
			aria-label="Prompt list"
		>
			<div class="grid gap-3 border-b border-border p-3">
				<div
					class="grid rounded-lg bg-muted p-1"
					class:grid-cols-3={available}
					role="group"
					aria-label="Prompt sources"
				>
					{#if available}<button
							type="button"
							aria-pressed={source === 'prompts'}
							class:bg-card={source === 'prompts'}
							onclick={() => {
								source = 'prompts';
								editor = null;
								mobileDetail = false;
							}}
							>Prompts <span class="text-muted-foreground"
								>{workflows.filter((item) => !item.archived).length}</span
							></button
						>{/if}
					<button
						type="button"
						aria-pressed={source === 'community'}
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
					{#if available}<button
							type="button"
							aria-pressed={source === 'bundles'}
							class:bg-card={source === 'bundles'}
							onclick={() => {
								source = 'bundles';
								editor = null;
								mobileDetail = false;
								void ensureBundles();
							}}>Bundles <span class="text-muted-foreground">{bundles.length}</span></button
						>{/if}
				</div>
				{#if source !== 'bundles'}<label
						class="flex min-h-11 items-center gap-2 rounded-lg border border-input bg-background px-3"
						><Search width={17} height={17} aria-hidden="true" /><span class="sr-only"
							>Search prompts</span
						><input
							class="min-w-0 flex-1 border-0 bg-transparent outline-none"
							bind:value={query}
							placeholder="Search prompts…"
						/></label
					>{/if}
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
								onclick={addFolder}><FolderPlus width={17} height={17} aria-hidden="true" /></button
							><button type="button" onclick={toggleArchived}
								>{showArchived ? 'Hide archived' : 'Show archived'}</button
							>
						</div>
					</div>{:else if source === 'bundles'}<button
						type="button"
						class="inline-flex min-h-11 items-center gap-2"
						onclick={() => {
							startBundleCreate();
							mobileDetail = true;
						}}><Plus width={16} height={16} aria-hidden="true" />New bundle</button
					>{/if}
			</div>
			<nav
				class="min-h-0 flex-1 overflow-y-auto p-2"
				aria-label={source === 'community'
					? 'Community prompts'
					: source === 'bundles'
						? 'Hermes bundles'
						: 'Prompts'}
			>
				{#if bundlesLoading && source === 'bundles'}<p
						class="p-4 text-center text-sm text-muted-foreground"
						role="status"
					>
						Loading bundles…
					</p>
				{:else if source === 'bundles'}
					{#each bundles as item (item.slug)}<button
							type="button"
							class="mb-1 grid min-h-12 w-full gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-accent"
							class:bg-accent={selectedBundleSlug === item.slug && !creatingBundle}
							aria-pressed={selectedBundleSlug === item.slug && !creatingBundle}
							onclick={() => {
								selectBundle(item);
								mobileDetail = true;
							}}
							><strong class="truncate text-sm">{item.name}</strong><span
								class="truncate text-xs text-muted-foreground"
								>/{item.slug} · {item.skills.length} skills</span
							></button
						>{/each}
					{#if !bundles.length}<p class="p-5 text-center text-sm text-muted-foreground">
							No Hermes bundles installed.
						</p>{/if}
				{:else if loading && source === 'prompts'}<p
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
					{#each promptGroups as group}<details class="group mb-3" open={Boolean(normalizedQuery)}>
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
										>{item.archived ? 'Archived · ' : ''}{item.profile} · {item.bundle}</span
									></button
								>{/each}
						</details>{/each}
				{:else}<p class="p-5 text-center text-sm text-muted-foreground">
						{query ? 'No matching prompts.' : 'No custom prompts yet.'}
					</p>{/if}
			</nav>
			{#if source !== 'bundles'}<p class="border-t border-border p-3 text-xs text-muted-foreground">
					Open catalog curated from <a
						class="underline"
						href="https://github.com/f/prompts.chat"
						target="_blank"
						rel="noreferrer">prompts.chat</a
					> · CC0
				</p>{/if}
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
				}}>Back to {source === 'bundles' ? 'bundles' : 'prompts'}</button
			>
			{#if source === 'bundles'}
				{#if bundleError}<p class="mb-3 text-sm text-destructive" role="alert">
						{bundleError}
					</p>{/if}
				{#if openedSkill}
					<section class="mx-auto grid max-w-2xl gap-3" aria-label={`${openedSkill} skill editor`}>
						<div class="flex flex-wrap items-center gap-3">
							<button type="button" class="min-h-11" onclick={() => (openedSkill = '')}
								>Back to bundle</button
							>
							<h3 class="text-base font-semibold">{openedSkill}</h3>
							{#if !skillEditable}<span class="text-sm text-muted-foreground"
									>Read-only · {skillProvenance}</span
								>{/if}
						</div>
						<textarea
							class="min-h-[min(480px,60dvh)] font-mono"
							bind:value={skillContent}
							aria-label="Skill content"
							spellcheck="false"
							disabled={!skillEditable}></textarea>
						<button
							type="button"
							class="min-h-11 w-fit"
							disabled={!skillEditable || skillSaving}
							onclick={saveSkill}>{skillSaving ? 'Saving…' : 'Save skill'}</button
						>
					</section>
				{:else if creatingBundle || selectedBundleSlug}
					<form
						class="workflow-form mx-auto grid max-w-2xl content-start gap-4"
						onsubmit={saveBundle}
					>
						<div>
							<h3 class="text-base font-semibold">
								{creatingBundle ? 'Add Hermes bundle' : bundleName}
							</h3>
							{#if !creatingBundle}<p class="text-sm text-muted-foreground">
									{bundleDescription}
								</p>{/if}
						</div>
						<label class="grid gap-1 text-sm"
							><span>Bundle name</span><input
								bind:value={bundleName}
								disabled={!creatingBundle}
								required
								maxlength="128"
							/></label
						>
						<label class="grid gap-1 text-sm"
							><span>Bundle description</span><input
								bind:value={bundleDescription}
								maxlength="1000"
							/></label
						>
						<label class="grid gap-1 text-sm"
							><span>Bundle instruction</span><textarea
								class="min-h-28"
								bind:value={bundleInstruction}
								maxlength="10000"></textarea></label
						>
						<fieldset class="grid gap-2 rounded-xl border border-border p-3">
							<legend class="px-1 text-sm font-semibold">Member skills</legend>
							{#each bundleSkills as skill (skill.name)}<label
									class="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent"
									><input
										type="checkbox"
										aria-label={`Include ${skill.name}`}
										checked={bundleMembers.includes(skill.name)}
										onchange={(event) => toggleBundleSkill(skill.name, event.currentTarget.checked)}
									/><span class="min-w-0"
										><strong>{skill.name}</strong>{#if skill.description}<small
												class="block text-muted-foreground">{skill.description}</small
											>{/if}</span
									></label
								>{/each}
						</fieldset>
						{#if !creatingBundle && bundleMembers.length}<section
								class="grid gap-2"
								aria-label="Bundle member skills"
							>
								<h4 class="text-sm font-semibold">Open member skill</h4>
								<div class="flex flex-wrap gap-2">
									{#each bundleMembers as member}<button
											type="button"
											class="min-h-11 rounded-md border border-border px-3"
											aria-label={`Open ${member} skill`}
											onclick={() => openSkill(member)}>{member}</button
										>{/each}
								</div>
							</section>{/if}
						<div class="flex flex-wrap justify-between gap-2">
							{#if !creatingBundle}<button
									type="button"
									class="min-h-11 text-destructive"
									onclick={deleteBundle}>Delete bundle</button
								>{/if}
							<button type="submit" class="min-h-11" disabled={!bundleMembers.length}
								>{creatingBundle ? 'Add bundle' : 'Save bundle'}</button
							>
						</div>
					</form>
				{:else}<div
						class="grid min-h-64 place-items-center text-center text-sm text-muted-foreground"
					>
						<p>Create a Hermes bundle to group skills for Workflows.</p>
					</div>{/if}
			{:else if editor === 'create'}
				<form
					class="workflow-form mx-auto grid max-w-2xl content-start gap-3"
					onsubmit={saveCreate}
				>
					<div class="flex items-center justify-between">
						<h3 class="text-base font-semibold">Add custom prompt</h3>
						<button type="button" onclick={() => (editor = null)}>Cancel</button>
					</div>
					<label class="grid gap-1 text-sm"
						><span>Name</span><input bind:value={name} aria-label="Workflow name" required /></label
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
							><span>Hermes bundle</span><select bind:value={bundle} required
								>{#if bundle && !bundles.some(({ slug }) => slug === bundle)}<option value={bundle}
										>{bundle} (unavailable)</option
									>{/if}{#each bundles as item}<option value={item.slug}>{item.name}</option
									>{/each}</select
							></label
						>
					</div>
					<button type="submit" title="Save prompt">Add prompt</button>
				</form>
			{:else if editor === 'edit' && editing}
				<form class="workflow-form mx-auto grid max-w-2xl content-start gap-3" onsubmit={saveEdit}>
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
							><span>Hermes bundle</span><select bind:value={editBundle} required
								>{#if editBundle && !bundles.some(({ slug }) => slug === editBundle)}<option
										value={editBundle}>{editBundle} (unavailable)</option
									>{/if}{#each bundles as item}<option value={item.slug}>{item.name}</option
									>{/each}</select
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
						{#if available}<button
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
							>{/if}
					</div>
					<div class="rounded-xl border border-border bg-background p-4">
						<p class="text-sm leading-6 whitespace-pre-wrap">{selectedCatalog.prompt}</p>
					</div>
					<button
						type="button"
						class="inline-flex min-h-11 w-fit items-center gap-2"
						aria-label={`Add ${selectedCatalog.title} to input`}
						onclick={() => oninsert(selectedCatalog.prompt)}
						><Plus width={17} height={17} aria-hidden="true" />Add to input</button
					>
					{#if available}<button
							type="button"
							class="inline-flex min-h-11 w-fit items-center gap-2"
							onclick={() => startCreate(selectedCatalog)}
							><Plus width={17} height={17} aria-hidden="true" />Add to custom prompts</button
						>{/if}
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
								{projectName} · {selectedWorkflow.profile} · {bundles.find(
									({ slug }) => slug === selectedWorkflow.bundle
								)?.name ?? selectedWorkflow.bundle}{selectedWorkflow.archived ? ' · Archived' : ''}
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
								onclick={() => onupdate(selectedWorkflow, { favorite: !selectedWorkflow.favorite })}
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
										role="group"
										aria-label="Workflow actions"
										tabindex="-1"
									>
										<button
											type="button"
											class="flex items-center gap-2"
											onclick={() => startEdit(selectedWorkflow)}
											><Pencil width={15} height={15} aria-hidden="true" />Edit Workflow</button
										><button
											type="button"
											class="flex items-center gap-2"
											onclick={() => {
												actions = false;
												void onduplicate(selectedWorkflow);
											}}
											><Copy width={15} height={15} aria-hidden="true" />Duplicate Workflow</button
										><button
											type="button"
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
							onclick={() => oninsert(selectedWorkflow.prompt)}
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
</dialog>
