<script lang="ts">
	import { marked } from 'marked';
	import sanitizeHtml from 'sanitize-html';
	import { ArrowLeft, Download, Pencil, Save, Trash2 } from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import Textarea from '../ui/Textarea.svelte';
	import { formatFileSize, type FilePreview } from './file-types';

	let {
		preview,
		selectedPath,
		contentUrl,
		editor,
		markdownMode,
		dirty,
		busy,
		error,
		status,
		externalChange,
		movedDeleted,
		onback,
		onmove,
		ondelete,
		onsave,
		onreload,
		onroot,
		onbreadcrumb,
		oneditor,
		onmarkdownmode
	}: {
		preview: FilePreview | null;
		selectedPath: string;
		contentUrl: string;
		editor: string;
		markdownMode: 'preview' | 'edit';
		dirty: boolean;
		busy: boolean;
		error: string;
		status: string;
		externalChange: boolean;
		movedDeleted: boolean;
		onback: () => void;
		onmove: () => void;
		ondelete: () => void;
		onsave: () => void;
		onreload: () => void;
		onroot: () => void;
		onbreadcrumb: (path: string) => void;
		oneditor: (value: string) => void;
		onmarkdownmode: (value: 'preview' | 'edit') => void;
	} = $props();

	const markdown = (value: string) => sanitizeHtml(marked.parse(value, { async: false }));
	const breadcrumbs = () => (selectedPath ? selectedPath.split('/').slice(0, -1) : []);
</script>

<article class="file-preview flex min-h-0 min-w-0 flex-col" class:open={Boolean(preview)}>
	<header class="flex min-h-11 items-center gap-2 border-b border-border px-3">
		<Button
			class="file-preview-back hidden"
			variant="ghost"
			size="icon"
			aria-label="Back to files"
			title="Back to files"
			onclick={onback}><ArrowLeft size={16} aria-hidden="true" /></Button
		>
		<nav class="file-breadcrumbs flex min-w-0 items-center text-xs" aria-label="File breadcrumbs">
			<button onclick={onroot}>Project</button>
			{#each breadcrumbs() as crumb, index}<span aria-hidden="true">/</span><button
					onclick={() =>
						onbreadcrumb(
							selectedPath
								.split('/')
								.slice(0, index + 1)
								.join('/')
						)}>{crumb}</button
				>{/each}
		</nav>
		{#if preview}<div class="ml-auto flex gap-1">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Rename or move file"
					title="Rename or move file"
					disabled={!preview.version}
					onclick={onmove}><Pencil size={15} aria-hidden="true" /></Button
				>
				<a
					class="grid size-9 place-items-center rounded-md hover:bg-accent"
					aria-label="Download file"
					title="Download file"
					href={`${contentUrl}&download=1`}><Download size={15} aria-hidden="true" /></a
				>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Delete file"
					title="Delete file"
					onclick={ondelete}><Trash2 size={15} aria-hidden="true" /></Button
				>
			</div>{/if}
	</header>
	{#if error}<p
			class="m-2 rounded border border-destructive/40 p-2 text-xs text-destructive"
			role="alert"
		>
			{error}
		</p>{/if}
	{#if status}<p class="m-2 text-xs text-emerald-400" role="status">{status}</p>{/if}
	{#if movedDeleted}<div class="m-2 rounded border border-amber-400/40 p-2 text-xs" role="alert">
			<strong>File moved or deleted</strong>
			<p>Refresh tree, then choose current path. Unsaved text remains here.</p>
		</div>{/if}
	{#if externalChange}<div
			class="m-2 flex items-center gap-2 rounded border border-amber-400/40 p-2 text-xs"
			role="alert"
		>
			<span><strong>File changed outside HUE</strong> — saving is blocked.</span><Button
				class="ml-auto"
				size="sm"
				onclick={onreload}>Load external version</Button
			>
		</div>{/if}
	{#if preview}
		<div class="flex min-h-0 flex-1 flex-col overflow-auto p-3">
			{#if !preview.version}<p class="mb-2 text-xs text-amber-300" role="status">
					Concurrency-protected editing and moving unavailable: file exceeds hash limit.
				</p>{/if}
			<div class="file-preview-title mb-2 flex items-center gap-2">
				<h2 class="min-w-0 flex-1 overflow-hidden font-semibold text-ellipsis">{preview.name}</h2>
				<span class="text-xs text-muted-foreground">{formatFileSize(preview.size)}</span>
				{#if preview.kind === 'markdown'}<Button
						size="sm"
						variant="outline"
						onclick={() => onmarkdownmode(markdownMode === 'preview' ? 'edit' : 'preview')}
						>{markdownMode === 'preview' ? 'Edit Markdown' : 'Preview Markdown'}</Button
					>{/if}
				{#if preview.content !== null}<Button
						size="sm"
						disabled={!dirty || busy || externalChange || movedDeleted}
						aria-label="Save file"
						onclick={onsave}><Save size={14} aria-hidden="true" />Save file</Button
					>{/if}
			</div>
			{#if preview.content !== null && (preview.kind !== 'markdown' || markdownMode === 'edit')}
				<Textarea
					class="file-editor min-h-0 flex-1 resize-none font-mono text-xs"
					aria-label="File content"
					value={editor}
					oninput={(event) => oneditor((event.currentTarget as HTMLTextAreaElement).value)}
				/>
			{:else if preview.kind === 'markdown'}<div
					class="markdown min-h-0 overflow-auto rounded-md border border-border p-4"
				>
					{@html markdown(editor)}
				</div>
			{:else if preview.kind === 'image'}<img
					class="max-h-full min-h-0 max-w-full self-center object-contain"
					src={contentUrl}
					alt={`Preview of ${preview.name}`}
				/>
			{:else if preview.kind === 'audio'}<audio class="w-full" controls src={contentUrl}
					><track kind="captions" /></audio
				>
			{:else if preview.kind === 'video'}<video
					class="max-h-full min-h-0 max-w-full"
					controls
					src={contentUrl}><track kind="captions" /></video
				>
			{:else if preview.kind === 'pdf'}<iframe
					class="min-h-[420px] flex-1 border-0 bg-white"
					title={`PDF preview of ${preview.name}`}
					src={contentUrl}
				></iframe>
			{:else}<div class="grid flex-1 place-content-center text-center text-sm">
					<strong>Binary preview unavailable</strong>
					<p class="text-muted-foreground">
						{preview.mime} · {formatFileSize(preview.size)} · modified {new Date(
							preview.mtime
						).toLocaleString()}
					</p>
					<a class="mt-3 rounded-md border border-border p-2" href={`${contentUrl}&download=1`}
						>Download safely</a
					>
				</div>{/if}
		</div>
	{:else}<div class="grid flex-1 place-content-center text-center text-sm text-muted-foreground">
			<strong class="text-foreground">Choose a Project file</strong><span
				>Preview and edit supported files inside trusted Project root.</span
			>
		</div>{/if}
</article>
