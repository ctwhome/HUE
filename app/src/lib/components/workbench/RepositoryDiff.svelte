<script lang="ts">
	import { untrack } from 'svelte';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Copy from '~icons/lucide/copy';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import { api } from './api';
	import { boundedDiffLineRange, parseUnifiedDiff } from './repository-diff';
	import type { RepositoryDiffResponse } from './repository-diff';
	import type { ReviewContextSeed } from '$lib/message-content';

	type Scope = 'staged' | 'unstaged' | 'branch';

	let {
		projectId,
		repositoryPath,
		revision,
		onselect
	}: {
		projectId: string;
		repositoryPath: string;
		revision: string;
		onselect?: (context: ReviewContextSeed) => void;
	} = $props();
	let scope = $state<Scope>('unstaged');
	let base = $state('');
	let result = $state<RepositoryDiffResponse | null>(null);
	let loading = $state(false);
	let error = $state('');
	let selectedFile = $state('');
	let selectedHunk = $state(0);
	let selectionStart = $state<number | null>(null);
	let selectionEnd = $state<number | null>(null);
	let message = $state('');
	let requestGeneration = 0;
	const files = $derived(parseUnifiedDiff(result?.diff ?? ''));
	const currentFile = $derived(files.find(({ path }) => path === selectedFile) ?? files[0]);
	const currentHunk = $derived(currentFile?.hunks[selectedHunk]);

	function resetSelection() {
		selectionStart = selectionEnd = null;
		message = '';
	}

	async function loadDiff() {
		const request = ++requestGeneration;
		loading = true;
		error = '';
		message = '';
		const params = new URLSearchParams({ view: 'diff', scope, repository: repositoryPath });
		if (scope === 'branch' && base.trim()) params.set('base', base.trim());
		try {
			const response = await api<RepositoryDiffResponse>(
				`/api/projects/${projectId}/repository?${params}`
			);
			if (request !== requestGeneration) return;
			result = response;
			const nextFiles = parseUnifiedDiff(response.diff);
			if (!nextFiles.some(({ path }) => path === selectedFile))
				selectedFile = nextFiles[0]?.path ?? '';
			selectedHunk = 0;
			resetSelection();
		} catch (cause) {
			if (request === requestGeneration)
				error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (request === requestGeneration) loading = false;
		}
	}

	function selectLine(index: number) {
		if (selectionStart === null || selectionEnd !== null) {
			selectionStart = index;
			selectionEnd = null;
		} else {
			selectionEnd = index;
		}
		message = selectionEnd === null ? 'Select the last line.' : '';
	}

	function lineSelected(index: number) {
		if (selectionStart === null) return false;
		const end = selectionEnd ?? selectionStart;
		return index >= Math.min(selectionStart, end) && index <= Math.max(selectionStart, end);
	}

	async function copySelection() {
		if (!currentHunk || selectionStart === null) return;
		const selection = boundedDiffLineRange(
			currentHunk.lines.map(({ raw }) => raw),
			selectionStart,
			selectionEnd ?? selectionStart
		);
		await navigator.clipboard.writeText(selection.text);
		onselect?.({
			source: 'diff',
			label: `${currentFile?.path ?? 'Repository diff'} ${currentHunk.header}`,
			content: selection.text
		});
		message = selection.clipped ? 'Copied the first 200 selected lines.' : 'Selected lines copied.';
	}

	function moveHunk(direction: number) {
		if (!currentFile?.hunks.length) return;
		selectedHunk = Math.max(0, Math.min(currentFile.hunks.length - 1, selectedHunk + direction));
		resetSelection();
	}

	$effect(() => {
		const key = `${projectId}:${repositoryPath}:${revision}`;
		if (key) untrack(() => void loadDiff());
	});
</script>

<section
	class="my-2 min-w-0 overflow-hidden rounded-lg border border-border bg-background/40"
	aria-label="Diff review"
>
	<header class="flex min-w-0 flex-wrap items-end gap-2 border-b border-border p-2">
		<label class="grid min-w-28 flex-1 gap-1 text-[0.68rem] text-muted-foreground">
			Scope
			<select
				class="min-h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground max-[700px]:min-h-11"
				aria-label="Diff scope"
				bind:value={scope}
				onchange={() => void loadDiff()}
			>
				<option value="unstaged">Unstaged</option>
				<option value="staged">Staged</option>
				<option value="branch">Branch vs base</option>
			</select>
		</label>
		{#if scope === 'branch'}
			<label class="grid min-w-32 flex-1 gap-1 text-[0.68rem] text-muted-foreground">
				Base ref
				<input
					class="min-h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground max-[700px]:min-h-11"
					aria-label="Base ref"
					bind:value={base}
					placeholder={result?.base ? `Auto: ${result.base}` : 'Auto resolve'}
				/>
			</label>
		{/if}
		<button
			class="grid min-h-8 min-w-8 place-items-center rounded-md border border-border max-[700px]:min-h-11 max-[700px]:min-w-11"
			aria-label="Refresh diff"
			title="Refresh diff"
			disabled={loading}
			onclick={() => void loadDiff()}
			><RefreshCw
				width={15}
				height={15}
				class={loading ? 'animate-spin' : ''}
				aria-hidden="true"
			/></button
		>
	</header>

	{#if error}<p class="p-2 text-xs text-destructive" role="alert">{error}</p>{/if}
	{#if result?.truncated}<p
			class="border-b border-border px-2 py-1.5 text-xs text-[var(--warning)]"
			role="status"
		>
			Diff output was limited to {result.maxBytes.toLocaleString()} bytes. Review remaining changes in
			Git.
		</p>{/if}
	{#if result && (result.untrackedPaths.length || result.untrackedPathsTruncated)}
		<div class="border-b border-border px-2 py-2 text-xs text-[var(--warning)]" role="status">
			<p>Untracked files are not available in Git diff:</p>
			<ul class="mt-1 max-h-32 list-disc overflow-auto pl-5 font-mono text-[0.7rem]">
				{#each result.untrackedPaths as path}<li>{path}</li>{/each}
			</ul>
			{#if result.untrackedPathsTruncated}<p class="mt-1">
					Additional untracked paths were omitted after {result.maxBytes.toLocaleString()} bytes.
				</p>{/if}
		</div>
	{/if}

	<div class="flex min-w-0 flex-wrap items-center gap-2 border-b border-border p-2">
		<label class="min-w-0 flex-1 text-xs">
			<span class="sr-only">Changed file</span>
			<select
				class="min-h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs max-[700px]:min-h-11"
				aria-label="Changed file"
				bind:value={selectedFile}
				disabled={!files.length}
				onchange={() => {
					selectedHunk = 0;
					resetSelection();
				}}
			>
				{#each files as file}<option value={file.path}>{file.path}</option>{/each}
			</select>
		</label>
		<span class="text-[0.68rem] text-muted-foreground">
			{currentFile?.hunks.length
				? `${selectedHunk + 1} / ${currentFile.hunks.length} hunks`
				: 'No hunks'}
		</span>
		<button
			class="grid min-h-8 min-w-8 place-items-center rounded-md border border-border max-[700px]:min-h-11 max-[700px]:min-w-11"
			aria-label="Previous hunk"
			title="Previous hunk"
			disabled={selectedHunk === 0}
			onclick={() => moveHunk(-1)}><ChevronLeft width={15} height={15} aria-hidden="true" /></button
		><button
			class="grid min-h-8 min-w-8 place-items-center rounded-md border border-border max-[700px]:min-h-11 max-[700px]:min-w-11"
			aria-label="Next hunk"
			title="Next hunk"
			disabled={!currentFile || selectedHunk >= currentFile.hunks.length - 1}
			onclick={() => moveHunk(1)}><ChevronRight width={15} height={15} aria-hidden="true" /></button
		>
	</div>

	{#if currentHunk}
		<div
			class="max-h-80 min-w-0 overflow-auto font-mono text-[0.7rem]"
			aria-label="Unified diff lines"
		>
			<div class="sticky top-0 min-w-max border-b border-border bg-muted px-2 py-1 text-sky-300">
				{currentHunk.header}
			</div>
			{#each currentHunk.lines as line, index}
				<button
					class={`grid min-h-6 min-w-full grid-cols-[3rem_3rem_minmax(max-content,1fr)] text-left focus-visible:outline-2 focus-visible:outline-ring max-[700px]:min-h-11 ${lineSelected(index) ? 'bg-sky-500/20' : line.kind === 'addition' ? 'bg-emerald-500/10' : line.kind === 'deletion' ? 'bg-red-500/10' : ''}`}
					aria-label={`${line.kind === 'addition' ? 'Addition' : line.kind === 'deletion' ? 'Deletion' : line.kind === 'context' ? 'Context' : 'Metadata'}, ${line.oldLine ? `old line ${line.oldLine}` : ''}${line.oldLine && line.newLine ? ', ' : ''}${line.newLine ? `new line ${line.newLine}` : ''}: ${line.text}`}
					onclick={() => selectLine(index)}
				>
					<span
						class="border-r border-border px-1 text-right text-muted-foreground"
						aria-hidden="true">{line.oldLine ?? ''}</span
					>
					<span
						class="border-r border-border px-1 text-right text-muted-foreground"
						aria-hidden="true">{line.newLine ?? ''}</span
					>
					<code class="px-2 whitespace-pre">{line.raw || ' '}</code>
				</button>
			{/each}
		</div>
	{:else if !loading && !error}
		<p class="p-3 text-center text-xs text-muted-foreground">
			{result?.untrackedPaths.length || result?.untrackedPathsTruncated
				? 'No tracked diff lines in this scope. Untracked files are listed above.'
				: 'No changed lines in this scope.'}
		</p>
	{/if}

	<footer class="flex min-w-0 items-center gap-2 border-t border-border p-2">
		<span class="min-w-0 flex-1 truncate text-[0.68rem] text-muted-foreground" role="status"
			>{message || 'Select a first and last line to copy up to 200 lines.'}</span
		>
		<button
			class="flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs max-[700px]:min-h-11"
			disabled={selectionStart === null}
			onclick={() => void copySelection()}
			><Copy width={14} height={14} aria-hidden="true" />Copy selected lines</button
		>
	</footer>
</section>
