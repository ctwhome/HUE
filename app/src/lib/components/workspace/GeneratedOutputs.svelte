<script lang="ts">
	import Download from '~icons/lucide/download';
	import ExternalLink from '~icons/lucide/external-link';
	import File from '~icons/lucide/file';
	import FolderOpen from '~icons/lucide/folder-open';
	import Maximize2 from '~icons/lucide/maximize-2';
	import MonitorUp from '~icons/lucide/monitor-up';
	import {
		artifactKind,
		artifactName,
		artifactUrl,
		nativeArtifactOpenAllowed
	} from '$lib/artifact';
	import CsvPreview from './CsvPreview.svelte';

	let {
		paths,
		mediaPath,
		onshow,
		onmedia
	}: {
		paths: string[];
		mediaPath: string;
		onshow: (path: string) => void;
		onmedia: (path: string, action: 'open' | 'reveal') => void;
	} = $props();
	let selected = $state('');
	let kind = $derived(artifactKind(selected));
	let name = $derived(artifactName(selected));
	let src = $derived(artifactUrl(mediaPath, selected));

	$effect(() => {
		if (!paths.includes(selected)) selected = paths[0] ?? '';
	});
</script>

<section class="generated-outputs mb-3 min-w-0" aria-label="Generated outputs">
	<article
		class="generated-output-preview overflow-hidden rounded-lg border border-border bg-muted/25"
	>
		<header class="flex min-h-12 items-center gap-2 border-b border-border px-3">
			<div class="min-w-0 flex-1">
				<strong class="block truncate text-sm">{name}</strong>
				<span class="text-xs text-muted-foreground">{kind.toUpperCase()} output</span>
			</div>
			<div class="generated-output-toolbar flex shrink-0 items-center">
				{#if kind !== 'file'}<button
						class="grid size-11 place-items-center rounded-md hover:bg-accent"
						type="button"
						onclick={() => onshow(selected)}
						aria-label={`Expand ${selected}`}
						title="Expand"><Maximize2 width={16} height={16} aria-hidden="true" /></button
					>{/if}
				<a
					class="grid size-11 place-items-center rounded-md hover:bg-accent"
					href={src}
					target="_blank"
					rel="noreferrer"
					aria-label={`Preview ${selected}`}
					title="Open preview"><ExternalLink width={16} height={16} aria-hidden="true" /></a
				>
				<a
					class="grid size-11 place-items-center rounded-md hover:bg-accent"
					href={`${src}&download=true`}
					download
					aria-label={`Download ${selected}`}
					title="Download"><Download width={16} height={16} aria-hidden="true" /></a
				>
				{#if nativeArtifactOpenAllowed(selected)}<button
						class="grid size-11 place-items-center rounded-md hover:bg-accent"
						type="button"
						onclick={() => onmedia(selected, 'open')}
						aria-label={`Open ${selected}`}
						title="Open on this device"
						><MonitorUp width={16} height={16} aria-hidden="true" /></button
					>{/if}
				<button
					class="grid size-11 place-items-center rounded-md hover:bg-accent"
					type="button"
					onclick={() => onmedia(selected, 'reveal')}
					aria-label={`Reveal ${selected}`}
					title="Reveal in Finder"><FolderOpen width={16} height={16} aria-hidden="true" /></button
				>
			</div>
		</header>
		<div class="min-w-0 bg-black/5">
			{#if kind === 'image'}<div class="grid w-full place-items-center overflow-hidden">
					<img class="block max-h-[min(55vh,560px)] max-w-full object-contain" {src} alt={name} />
				</div>
			{:else if kind === 'csv'}<CsvPreview {src} {name} />
			{:else if kind === 'pdf' || kind === 'text' || kind === 'html'}<iframe
					class="h-[min(55vh,520px)] min-h-64 w-full border-0 bg-white"
					title={`Inline preview of ${name}`}
					aria-label={`Inline preview of ${name}`}
					{src}
					sandbox={kind === 'html' ? '' : undefined}
				></iframe>
			{:else if kind === 'video'}<video
					class="max-h-[min(55vh,560px)] w-full bg-black object-contain"
					controls
					{src}><track kind="captions" /></video
				>
			{:else if kind === 'audio'}<div class="grid min-h-32 place-items-center p-4">
					<audio class="w-full max-w-2xl" controls {src}><track kind="captions" /></audio>
				</div>
			{:else}<div
					class="grid min-h-32 place-items-center p-4 text-center text-sm text-muted-foreground"
				>
					<File width={28} height={28} aria-hidden="true" />
					<p>Download this artifact to view it.</p>
				</div>{/if}
		</div>
	</article>
	{#if paths.length > 1}<nav
			class="mt-2 flex touch-pan-x gap-2 overflow-x-auto overscroll-x-contain pb-1"
			aria-label="Generated output files"
		>
			{#each paths as path}<button
					type="button"
					class="flex min-h-11 max-w-56 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm hover:bg-accent"
					class:border-primary={path === selected}
					aria-pressed={path === selected}
					onclick={() => (selected = path)}
					aria-label={`Select ${artifactName(path)}`}
					title={path}
					><File class="shrink-0" width={15} height={15} aria-hidden="true" /><span class="truncate"
						>{artifactName(path)}</span
					></button
				>{/each}
		</nav>{/if}
</section>
