<script lang="ts">
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Download from '~icons/lucide/download';
	import File from '~icons/lucide/file';
	import Images from '~icons/lucide/images';
	import Music from '~icons/lucide/music';
	import X from '~icons/lucide/x';
	import { artifactKind, artifactName, artifactUrl } from '$lib/artifact';
	import CsvPreview from './CsvPreview.svelte';

	let { artifacts, mediaPath }: { artifacts: string[]; mediaPath: string } = $props();
	let trigger: HTMLButtonElement;
	let dialog: HTMLDialogElement;
	let index = $state(0);
	let artifact = $derived(artifacts[index] ?? artifacts[0] ?? '');
	const name = artifactName;
	const url = (path: string) => artifactUrl(mediaPath, path);
	const kind = artifactKind;
	function move(change: number) {
		index = (index + change + artifacts.length) % artifacts.length;
	}
	function open() {
		index = 0;
		dialog.showModal();
	}
	function handleKeydown(event: KeyboardEvent) {
		if ((event.target as Element).closest('input, textarea, select, button, a, audio, video'))
			return;
		if (event.key === 'ArrowLeft') move(-1);
		if (event.key === 'ArrowRight') move(1);
	}
</script>

<button
	bind:this={trigger}
	type="button"
	class="grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md hover:bg-accent"
	aria-label={`Open artifacts gallery, ${artifacts.length} ${artifacts.length === 1 ? 'artifact' : 'artifacts'}`}
	title="Artifacts"
	onclick={open}
>
	<Images width={18} height={18} aria-hidden="true" />
</button>

<dialog
	bind:this={dialog}
	class="m-auto h-[min(92dvh,900px)] w-[min(96vw,1200px)] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/80"
	aria-label="Session artifacts gallery"
	onclose={() => trigger.focus()}
	onkeydown={handleKeydown}
	onclick={(event) => event.target === dialog && dialog.close()}
>
	<div class="grid h-full min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
		<header class="flex min-h-14 items-center gap-2 border-b border-border px-3">
			<strong class="min-w-0 flex-1 truncate">{name(artifact)}</strong>
			<span class="text-sm text-muted-foreground">{index + 1} / {artifacts.length}</span>
			<a
				class="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-accent"
				href={`${url(artifact)}&download=true`}
				download
				aria-label={`Download ${artifact}`}
				title={`Download ${artifact}`}><Download width={18} height={18} aria-hidden="true" /></a
			>
			<button
				type="button"
				class="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-accent"
				onclick={() => dialog.close()}
				aria-label="Close artifacts gallery"
				title="Close"><X width={20} height={20} aria-hidden="true" /></button
			>
		</header>
		<div class="relative min-h-0 overflow-hidden bg-black/90">
			{#if kind(artifact) === 'image'}<img
					class="size-full object-contain"
					src={url(artifact)}
					alt={`Preview of ${name(artifact)}`}
				/>{:else if kind(artifact) === 'video'}<video
					class="size-full object-contain"
					controls
					src={url(artifact)}><track kind="captions" /></video
				>{:else if kind(artifact) === 'audio'}<div class="grid h-full place-items-center p-4">
					<audio class="w-full max-w-2xl" controls src={url(artifact)}
						><track kind="captions" /></audio
					>
				</div>{:else if kind(artifact) === 'csv'}<CsvPreview
					src={url(artifact)}
					name={name(artifact)}
					full
				/>{:else if kind(artifact) === 'pdf' || kind(artifact) === 'text' || kind(artifact) === 'html'}<iframe
					class="size-full border-0 bg-white"
					title={`Preview of ${name(artifact)}`}
					src={url(artifact)}
					sandbox={kind(artifact) === 'html' ? '' : undefined}
				></iframe>{:else}<div class="grid h-full place-items-center p-6 text-center text-white">
					<div>
						<Images class="mx-auto mb-3" width={40} height={40} aria-hidden="true" />
						<p>{name(artifact)}</p>
						<p class="text-sm text-white/70">Download this artifact to view it.</p>
					</div>
				</div>{/if}
			{#if artifacts.length > 1}<button
					type="button"
					class="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/70 text-white hover:bg-black"
					onclick={() => move(-1)}
					aria-label="Previous artifact"
					title="Previous artifact"
					><ChevronLeft width={24} height={24} aria-hidden="true" /></button
				><button
					type="button"
					class="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/70 text-white hover:bg-black"
					onclick={() => move(1)}
					aria-label="Next artifact"
					title="Next artifact"><ChevronRight width={24} height={24} aria-hidden="true" /></button
				>{/if}
		</div>
		<nav
			class="flex w-full max-w-full min-w-0 touch-pan-x gap-2 overflow-x-auto overscroll-x-contain border-t border-border p-2"
			aria-label="Artifacts"
		>
			{#each artifacts as path, artifactIndex}<button
					type="button"
					class="grid w-28 shrink-0 grid-rows-[64px_auto] overflow-hidden rounded-md border bg-muted/40 text-xs"
					class:border-primary={artifactIndex === index}
					class:border-border={artifactIndex !== index}
					aria-current={artifactIndex === index ? 'true' : undefined}
					aria-label={`Select ${name(path)}`}
					title={path}
					onclick={() => (index = artifactIndex)}
					>{#if kind(path) === 'image'}<img
							class="size-full bg-black object-cover"
							src={url(path)}
							alt={`Thumbnail of ${name(path)}`}
						/>{:else if kind(path) === 'video'}<video
							class="pointer-events-none size-full bg-black object-cover"
							muted
							preload="metadata"
							src={url(path)}
							aria-label={`Thumbnail of ${name(path)}`}><track kind="captions" /></video
						>{:else if kind(path) === 'pdf' || kind(path) === 'text' || kind(path) === 'html'}<iframe
							class="pointer-events-none size-full border-0 bg-white"
							title={`Thumbnail of ${name(path)}`}
							inert
							tabindex="-1"
							loading="lazy"
							src={url(path)}
							sandbox={kind(path) === 'html' ? '' : undefined}
						></iframe>{:else}<span class="grid size-full place-items-center bg-black/90 text-white"
							>{#if kind(path) === 'audio'}<Music
									width={24}
									height={24}
									aria-hidden="true"
								/>{:else}<File width={24} height={24} aria-hidden="true" />{/if}</span
						>{/if}<span class="min-h-8 truncate px-2 py-2">{name(path)}</span></button
				>{/each}
		</nav>
	</div>
</dialog>
