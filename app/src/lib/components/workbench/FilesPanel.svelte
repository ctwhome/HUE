<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronRight from '~icons/lucide/chevron-right';
	import ChevronsDownUp from '~icons/lucide/chevrons-down-up';
	import ChevronsUpDown from '~icons/lucide/chevrons-up-down';
	import FilePlus2 from '~icons/lucide/file-plus-2';
	import Folder from '~icons/lucide/folder';
	import FolderPlus from '~icons/lucide/folder-plus';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import Search from '~icons/lucide/search';
	import Upload from '~icons/lucide/upload';
	import X from '~icons/lucide/x';
	import { isFilePathHidden } from '$lib/hidden-file-patterns';
	import { defaultPreferences, readPreferences, type HUEPreferences } from '$lib/preferences';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { api } from './api';
	import FilePreview from './FilePreview.svelte';
	import FileTypeIcon from './FileTypeIcon.svelte';
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
		dirtyGuard,
		onclose
	}: {
		projectId: string;
		fileRequest: { path: string; id: string } | null;
		dirtyGuard: DirtyGuard;
		onclose?: () => void;
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
	let hiddenFilePatterns = $state(defaultPreferences.hiddenFilePatterns);
	const expandedStorageKey = () => `hue:project-files:${projectId}:expanded`;
	const previewRequests = createPreviewRequests();
	const treeItems = new Map<string, HTMLButtonElement>();
	let dirty = $derived(Boolean(preview?.content !== null && editor !== loadedContent));
	let contentUrl = $derived(previewContentUrl(projectId, preview?.path));
	let visibleEntries = $derived(
		entries.filter(({ path }) => !isFilePathHidden(path, hiddenFilePatterns))
	);
	function applyHiddenFilePatterns(value: string) {
		hiddenFilePatterns = value;
		const filtered = entries.filter(({ path }) => !isFilePathHidden(path, value));
		focusedPath = restoreTreeFocus(filtered, expanded, focusedPath || selectedPath);
	}
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
			focusedPath = restoreTreeFocus(visibleEntries, expanded, focusedPath || selectedPath);
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
		setExpanded(next);
	}
	function setExpanded(next: Set<string>) {
		expanded = next;
		localStorage.setItem(expandedStorageKey(), JSON.stringify([...next]));
	}
	function treeKey(event: KeyboardEvent, entry: Entry) {
		if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key))
			return;
		event.preventDefault();
		const action = treeKeyboardAction(visibleEntries, expanded, entry.path, event.key as TreeKey);
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
		applyHiddenFilePatterns(readPreferences(localStorage).hiddenFilePatterns);
		const updatePreferences = (event: Event) => {
			applyHiddenFilePatterns((event as CustomEvent<HUEPreferences>).detail.hiddenFilePatterns);
		};
		window.addEventListener('hue:preferences', updatePreferences);
		try {
			const saved = JSON.parse(localStorage.getItem(expandedStorageKey()) ?? '[]');
			if (Array.isArray(saved))
				expanded = new Set(saved.filter((path) => typeof path === 'string'));
		} catch {
			expanded = new Set();
		}
		void loadTree();
		return () => {
			window.removeEventListener('hue:preferences', updatePreferences);
			dirtySource.unregister();
			clearTimeout(searchTimer);
			previewRequests.cancel();
		};
	});
</script>

<section
	class="files-panel grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(240px,31%)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card"
	aria-label="Project files"
>
	<header
		class="file-workspace-header col-span-2 flex min-h-12 items-center gap-3 border-b border-border px-3"
		aria-label="File workspace"
	>
		<strong
			class="min-w-0 flex-1 overflow-hidden text-sm font-medium text-ellipsis whitespace-nowrap"
			>{selectedPath || 'Files'}</strong
		>
		{#if onclose}<Button
				variant="ghost"
				size="icon"
				aria-label="Close Files workspace"
				title="Close Files workspace"
				onclick={() => guarded(onclose)}><X width={18} height={18} aria-hidden="true" /></Button
			>{/if}
	</header>
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
			setExpanded(new Set(expanded));
		}}
		oneditor={(value) => (editor = value)}
		onmarkdownmode={(value) => (markdownMode = value)}
	/>

	<aside class="file-sidebar flex min-h-0 flex-col border-l border-border">
		<header class="border-b border-border p-2">
			<div class="file-sidebar-tabs flex min-w-0 items-center gap-1">
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
			</div>
			<div class="file-sidebar-actions mt-1 flex min-w-0 flex-wrap items-center justify-end gap-1">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Create file"
					title="Create file"
					onclick={() => openAction('file')}
					><FilePlus2 width={16} height={16} aria-hidden="true" /></Button
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Create folder"
					title="Create folder"
					onclick={() => openAction('folder')}
					><FolderPlus width={16} height={16} aria-hidden="true" /></Button
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Refresh files"
					title="Refresh files"
					onclick={() => guarded(() => void loadTree())}
					><RefreshCw width={16} height={16} aria-hidden="true" /></Button
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Expand all folders"
					title="Expand all folders"
					onclick={() =>
						setExpanded(
							new Set(
								visibleEntries.filter(({ type }) => type === 'directory').map(({ path }) => path)
							)
						)}><ChevronsUpDown width={16} height={16} aria-hidden="true" /></Button
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Collapse all folders"
					title="Collapse all folders"
					onclick={() => {
						setExpanded(new Set());
						focusedPath = restoreTreeFocus(visibleEntries, expanded, focusedPath);
					}}><ChevronsDownUp width={16} height={16} aria-hidden="true" /></Button
				>
				<label
					class="grid min-h-9 min-w-9 cursor-pointer place-items-center rounded-md hover:bg-accent"
					aria-label="Upload files"
					title="Upload files"
					><Upload width={16} height={16} aria-hidden="true" /><input
						class="sr-only"
						type="file"
						multiple
						onchange={uploadFiles}
					/></label
				>
			</div>
			{#if view === 'files'}<label
					class="mt-2 flex items-center gap-2 rounded-md border border-input px-2"
					><Search width={15} height={15} aria-hidden="true" /><Input
						class="border-0 px-0 focus-visible:ring-0"
						bind:value={query}
						oninput={scheduleSearch}
						aria-label="Search Project files"
						placeholder="Search files…"
					/></label
				>{/if}
		</header>
		{#if view === 'files'}
			<div class="min-h-0 flex-1 overflow-auto p-1" role="tree" aria-label="Project file tree">
				{#if loading}<p class="p-2 text-xs text-muted-foreground" role="status">
						Indexing files…
					</p>{/if}
				{#each visibleFileEntries(visibleEntries, expanded) as entry}
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
									width={14}
									height={14}
									aria-hidden="true"
								/>{:else}<ChevronRight width={14} height={14} aria-hidden="true" />{/if}<Folder
								width={15}
								height={15}
								aria-hidden="true"
							/>{:else}<span class="w-3.5"></span><FileTypeIcon path={entry.path} />{/if}
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
