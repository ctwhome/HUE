<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		ChevronDown,
		ChevronRight,
		ChevronsDownUp,
		ChevronsUpDown,
		File,
		FilePlus2,
		Folder,
		FolderPlus,
		RefreshCw,
		Search,
		Upload
	} from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { api } from './api';
	import FilePreview from './FilePreview.svelte';
	import FileDialogs from './FileDialogs.svelte';
	import {
		restoreTreeFocus,
		treeKeyboardAction,
		visibleFileEntries,
		type TreeKey
	} from './file-tree';
	import type { DirtyGuard } from '../workspace/dirty-guard';
	import { uploadProjectFiles } from './file-upload';
	import {
		canSavePreview,
		createPreviewRequests,
		isCurrentSave,
		previewContentUrl,
		sameFileVersion,
		savePreview
	} from './file-preview-requests';
	import {
		type Artifact,
		type DeleteImpact,
		type FileEntry as Entry,
		type FilePreview as Preview
	} from './file-types';

	let {
		projectId,
		fileRequest,
		dirtyGuard
	}: {
		projectId: string;
		fileRequest: { path: string; id: string } | null;
		dirtyGuard: DirtyGuard;
	} = $props();
	let entries = $state<Entry[]>([]);
	let expanded = $state(new Set<string>());
	let query = $state('');
	let truncated = $state(false);
	let loading = $state(false);
	let busy = $state(false);
	let error = $state('');
	let status = $state('');
	let selectedPath = $state('');
	let focusedPath = $state('');
	let preview = $state<Preview | null>(null);
	let editor = $state('');
	let loadedContent = $state('');
	let markdownMode = $state<'preview' | 'edit'>('preview');
	let externalChange = $state(false);
	let movedDeleted = $state(false);
	let view = $state<'files' | 'artifacts'>('files');
	let artifacts = $state<Artifact[]>([]);
	let actionOpen = $state(false),
		deleteOpen = $state(false);
	let action = $state<'file' | 'folder' | 'move'>('file');
	let actionPath = $state('');
	let deleteImpact = $state<DeleteImpact | null>(null);
	let deleteConfirmation = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let handledFileRequest = '';
	const previewRequests = createPreviewRequests();
	const treeItems = new Map<string, HTMLButtonElement>();
	let dirty = $derived(Boolean(preview?.content !== null && editor !== loadedContent));
	let contentUrl = $derived(previewContentUrl(projectId, preview?.path));
	function discardChanges() {
		editor = loadedContent;
		externalChange = movedDeleted = false;
	}
	const dirtySource = untrack(() => dirtyGuard.register(discardChanges));
	function clearPreviewSelection() {
		previewRequests.cancel();
		preview = null;
		selectedPath = '';
	}
	function guarded(action: () => void) {
		if (!dirtyGuard.block(action)) action();
	}
	function treeItem(node: HTMLButtonElement, path: string) {
		treeItems.set(path, node);
		return { destroy: () => treeItems.delete(path) };
	}
	async function focusTree(path: string) {
		focusedPath = path;
		await tick();
		treeItems.get(path)?.focus();
	}
	async function loadTree() {
		loading = true;
		error = '';
		try {
			const body = query.trim()
				? await api<{ results: Entry[]; truncated: boolean }>(
						`/api/projects/${projectId}/files?mode=search&query=${encodeURIComponent(query)}`
					)
				: await api<{ entries: Entry[]; truncated: boolean }>(
						`/api/projects/${projectId}/files?mode=tree`
					);
			entries = 'entries' in body ? body.entries : body.results;
			truncated = body.truncated;
			focusedPath = restoreTreeFocus(entries, expanded, focusedPath || selectedPath);
			if (selectedPath) await checkSelected();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}
	async function checkSelected() {
		const request = previewRequests.begin(projectId, selectedPath);
		try {
			const current = await request.result;
			if (!previewRequests.isCurrent(request, selectedPath) || current.path !== request.path)
				return;
			movedDeleted = false;
			if (preview && !sameFileVersion(current.version, preview.version)) {
				externalChange = true;
				if (!dirty) applyPreview(current);
			}
		} catch {
			if (previewRequests.isCurrent(request, selectedPath)) movedDeleted = true;
		}
	}
	function requestSelect(path: string) {
		if (path === selectedPath && preview) return;
		guarded(() => void selectFile(path));
	}
	function requestClosePreview() {
		guarded(clearPreviewSelection);
	}
	async function selectFile(path: string) {
		const request = previewRequests.begin(projectId, path);
		busy = true;
		error = '';
		selectedPath = path;
		movedDeleted = externalChange = false;
		try {
			const value = await request.result;
			if (!previewRequests.isCurrent(request, selectedPath)) return;
			if (value.path !== request.path)
				throw new Error('Preview response path does not match selection');
			applyPreview(value);
		} catch (cause) {
			if (!previewRequests.isCurrent(request, selectedPath)) return;
			preview = null;
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (previewRequests.isLatest(request)) busy = false;
		}
	}
	function applyPreview(value: Preview) {
		preview = value;
		editor = loadedContent = value.content ?? '';
		markdownMode = 'preview';
		externalChange = false;
	}
	function toggleFolder(path: string) {
		const next = new Set(expanded);
		next.has(path) ? next.delete(path) : next.add(path);
		expanded = next;
	}
	function treeKey(event: KeyboardEvent, entry: Entry) {
		if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key))
			return;
		event.preventDefault();
		const action = treeKeyboardAction(entries, expanded, entry.path, event.key as TreeKey);
		if (action.expand && !expanded.has(action.expand)) toggleFolder(action.expand);
		if (action.collapse && expanded.has(action.collapse)) toggleFolder(action.collapse);
		void focusTree(action.focusPath);
	}
	function scheduleSearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(loadTree, 180);
	}
	async function saveFile() {
		const target = preview;
		if (!canSavePreview(target, selectedPath, dirty, busy)) return;
		busy = true;
		error = status = '';
		try {
			const saved = await savePreview(projectId, target, editor);
			if (!isCurrentSave(saved, target, selectedPath, preview)) return;
			applyPreview(saved);
			status = 'File saved';
			await loadTree();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			if (error.includes('File changed outside HUE')) externalChange = true;
		} finally {
			busy = false;
		}
	}
	function openAction(kind: 'file' | 'folder' | 'move') {
		guarded(() => {
			action = kind;
			actionPath = kind === 'move' ? selectedPath : '';
			actionOpen = true;
		});
	}
	async function submitAction(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			if (action === 'file')
				await api(`/api/projects/${projectId}/files`, {
					method: 'POST',
					body: JSON.stringify({ action: 'save', path: actionPath, content: '' })
				});
			else if (action === 'folder')
				await api(`/api/projects/${projectId}/files`, {
					method: 'POST',
					body: JSON.stringify({ action: 'mkdir', path: actionPath })
				});
			else if (preview?.version)
				await api(`/api/projects/${projectId}/files`, {
					method: 'POST',
					body: JSON.stringify({
						action: 'move',
						path: selectedPath,
						destination: actionPath,
						expected: preview.version
					})
				});
			actionOpen = false;
			status = action === 'move' ? 'File moved' : 'Created';
			selectedPath = actionPath;
			await loadTree();
			if (action !== 'folder') await selectFile(actionPath);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
	async function openDelete() {
		if (!selectedPath) return;
		guarded(() => {
			void (async () => {
				deleteImpact = await api(
					`/api/projects/${projectId}/files?mode=impact&path=${encodeURIComponent(selectedPath)}`
				);
				deleteConfirmation = '';
				deleteOpen = true;
			})();
		});
	}
	async function deleteSelected() {
		if (!deleteImpact) return;
		busy = true;
		error = '';
		try {
			await api(`/api/projects/${projectId}/files`, {
				method: 'POST',
				body: JSON.stringify({
					action: 'delete',
					path: selectedPath,
					confirmation: deleteConfirmation
				})
			});
			deleteOpen = false;
			preview = null;
			selectedPath = '';
			status = 'Deleted';
			await loadTree();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
	async function uploadFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		error = await uploadProjectFiles(projectId, input);
		input.value = '';
		await loadTree();
	}
	async function loadArtifacts() {
		view = 'artifacts';
		try {
			artifacts = (
				await api<{ artifacts: Artifact[] }>(`/api/projects/${projectId}/files?mode=artifacts`)
			).artifacts;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
	$effect(() => dirtySource.setDirty(dirty));
	$effect(() => {
		if (fileRequest && fileRequest.id !== handledFileRequest) {
			handledFileRequest = fileRequest.id;
			requestSelect(fileRequest.path);
		}
	});
	onMount(() => {
		void loadTree();
		return () => {
			dirtySource.unregister();
			clearTimeout(searchTimer);
			previewRequests.cancel();
		};
	});
</script>

<section
	class="files-panel grid min-h-0 flex-1 grid-cols-[minmax(260px,34%)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card"
	aria-label="Project files"
>
	<aside class="file-sidebar flex min-h-0 flex-col border-r border-border">
		<header class="border-b border-border p-2">
			<div class="flex items-center gap-1">
				<Button
					variant={view === 'files' ? 'secondary' : 'ghost'}
					size="sm"
					onclick={() => (view = 'files')}>Files</Button
				>
				<Button
					variant={view === 'artifacts' ? 'secondary' : 'ghost'}
					size="sm"
					onclick={loadArtifacts}>Artifacts and evidence</Button
				>
				<Button
					class="ml-auto"
					variant="ghost"
					size="icon"
					aria-label="Refresh files"
					title="Refresh files"
					onclick={() => guarded(() => void loadTree())}
					><RefreshCw size={16} aria-hidden="true" /></Button
				>
			</div>
			{#if view === 'files'}<label
					class="mt-2 flex items-center gap-2 rounded-md border border-input px-2"
					><Search size={15} aria-hidden="true" /><Input
						class="border-0 px-0 focus-visible:ring-0"
						bind:value={query}
						oninput={scheduleSearch}
						aria-label="Search Project files"
						placeholder="Search paths"
					/></label
				>{/if}
		</header>
		{#if view === 'files'}
			<div class="flex gap-1 border-b border-border p-1.5">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Expand all folders"
					title="Expand all folders"
					onclick={() =>
						(expanded = new Set(
							entries.filter(({ type }) => type === 'directory').map(({ path }) => path)
						))}><ChevronsUpDown size={16} aria-hidden="true" /></Button
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Collapse all folders"
					title="Collapse all folders"
					onclick={() => {
						expanded = new Set();
						focusedPath = restoreTreeFocus(entries, expanded, focusedPath);
					}}><ChevronsDownUp size={16} aria-hidden="true" /></Button
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Create file"
					title="Create file"
					onclick={() => openAction('file')}><FilePlus2 size={16} aria-hidden="true" /></Button
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Create folder"
					title="Create folder"
					onclick={() => openAction('folder')}><FolderPlus size={16} aria-hidden="true" /></Button
				>
				<label
					class="grid min-h-9 min-w-9 cursor-pointer place-items-center rounded-md hover:bg-accent"
					aria-label="Upload files"
					title="Upload files"
					><Upload size={16} aria-hidden="true" /><input
						class="sr-only"
						type="file"
						multiple
						onchange={uploadFiles}
					/></label
				>
			</div>
			<div class="min-h-0 flex-1 overflow-auto p-1" role="tree" aria-label="Project file tree">
				{#if loading}<p class="p-2 text-xs text-muted-foreground" role="status">
						Indexing files…
					</p>{/if}
				{#each visibleFileEntries(entries, expanded) as entry}
					<button
						use:treeItem={entry.path}
						class="file-tree-row flex w-full items-center gap-1 rounded px-1.5 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
						class:bg-muted={selectedPath === entry.path}
						style={`padding-left:${6 + (entry.path.split('/').length - 1) * 16}px;min-height: 44px`}
						role="treeitem"
						aria-level={entry.path.split('/').length}
						aria-expanded={entry.type === 'directory' ? expanded.has(entry.path) : undefined}
						aria-selected={entry.type === 'file' ? selectedPath === entry.path : undefined}
						tabindex={focusedPath === entry.path ? 0 : -1}
						onfocus={() => (focusedPath = entry.path)}
						onclick={() => {
							focusedPath = entry.path;
							entry.type === 'directory' ? toggleFolder(entry.path) : requestSelect(entry.path);
						}}
						onkeydown={(event) => treeKey(event, entry)}
					>
						{#if entry.type === 'directory'}{#if expanded.has(entry.path)}<ChevronDown
									size={14}
									aria-hidden="true"
								/>{:else}<ChevronRight size={14} aria-hidden="true" />{/if}<Folder
								size={15}
								aria-hidden="true"
							/>{:else}<span class="w-3.5"></span><File size={15} aria-hidden="true" />{/if}
						<span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span
						>
					</button>
				{/each}
				{#if truncated}<p class="p-2 text-xs text-amber-300" role="status">
						Results truncated at safe index limit.
					</p>{/if}
			</div>
		{:else}
			<ul class="min-h-0 flex-1 list-none overflow-auto p-2">
				{#each artifacts as artifact}<li>
						<button
							class="mb-1 w-full rounded-md border border-border p-2 text-left text-xs"
							style="min-height: 44px"
							onclick={() => {
								view = 'files';
								requestSelect(artifact.path);
							}}
							><strong>{artifact.path}</strong><span
								class="mt-1 flex justify-between text-muted-foreground"
								><span>{artifact.classification}</span><span>Not verified</span></span
							><small>{artifact.provenance}</small></button
						>
					</li>{/each}
			</ul>
		{/if}
	</aside>

	<FilePreview
		{preview}
		{selectedPath}
		{contentUrl}
		{editor}
		{markdownMode}
		{dirty}
		{busy}
		{error}
		{status}
		{externalChange}
		{movedDeleted}
		onback={requestClosePreview}
		onmove={() => openAction('move')}
		ondelete={openDelete}
		onsave={saveFile}
		onreload={() => guarded(() => void selectFile(selectedPath))}
		onroot={() => guarded(clearPreviewSelection)}
		onbreadcrumb={(path) => {
			expanded.add(path);
			expanded = new Set(expanded);
		}}
		oneditor={(value) => (editor = value)}
		onmarkdownmode={(value) => (markdownMode = value)}
	/>
</section>

<FileDialogs
	{actionOpen}
	{deleteOpen}
	{action}
	{actionPath}
	{deleteImpact}
	{deleteConfirmation}
	{busy}
	onsubmit={submitAction}
	ondelete={deleteSelected}
	onclose={(kind) => {
		if (kind === 'action') actionOpen = false;
		else deleteOpen = false;
	}}
	onactionpath={(value) => (actionPath = value)}
	ondeleteconfirmation={(value) => (deleteConfirmation = value)}
/>
