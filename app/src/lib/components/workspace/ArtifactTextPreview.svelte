<script lang="ts">
	import Code2 from '~icons/lucide/code-2';
	import Eye from '~icons/lucide/eye';
	import { renderFileMarkdown } from '$lib/file-markdown';
	import { highlightFileSource } from '$lib/file-source-highlight';

	let { src, name, full = false }: { src: string; name: string; full?: boolean } = $props();
	let content = $state('');
	let error = $state('');
	let loading = $state(true);
	let mode = $state<'preview' | 'source'>('source');
	let markdown = $derived(/\.(?:md|markdown)$/i.test(name));
	let highlighted = $derived(highlightFileSource(content, name));
	let rendered = $derived(renderFileMarkdown(content));

	$effect(() => {
		const controller = new AbortController();
		mode = markdown ? 'preview' : 'source';
		content = '';
		error = '';
		loading = true;
		void fetch(src, { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(`Preview failed (${response.status})`);
				content = await response.text();
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					error = cause instanceof Error ? cause.message : String(cause);
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});
</script>

<div
	class={`artifact-text-preview flex min-h-0 w-full flex-col bg-background text-foreground ${full ? 'h-full' : 'h-[min(55vh,520px)] min-h-64'}`}
>
	{#if markdown}<header
			class="flex min-h-11 shrink-0 items-center justify-end gap-1 border-b border-border px-2"
			aria-label="Markdown view"
		>
			<button
				type="button"
				class="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-accent max-[700px]:min-h-11"
				class:bg-accent={mode === 'preview'}
				aria-pressed={mode === 'preview'}
				onclick={() => (mode = 'preview')}
				><Eye width={14} height={14} aria-hidden="true" />Preview</button
			><button
				type="button"
				class="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-accent max-[700px]:min-h-11"
				class:bg-accent={mode === 'source'}
				aria-pressed={mode === 'source'}
				onclick={() => (mode = 'source')}
				><Code2 width={14} height={14} aria-hidden="true" />Source</button
			>
		</header>{/if}
	{#if loading}<div
			class="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground"
			role="status"
		>
			Loading preview…
		</div>{:else if error}<div
			class="grid min-h-0 flex-1 place-items-center p-4 text-sm text-destructive"
			role="alert"
		>
			{error}
		</div>{:else if markdown && mode === 'preview'}<div class="min-h-0 flex-1 overflow-auto">
			<div class="markdown min-h-full p-[clamp(20px,3vw,44px)] text-base leading-relaxed">
				{@html rendered}
			</div>
		</div>{:else}<div class="file-editor-code min-h-0 flex-1 overflow-auto">
			<pre
				class="file-editor-highlight m-0 min-h-full w-max min-w-full p-4 font-mono text-sm"
				aria-label={`Source preview of ${name}`}><code>{@html highlighted}</code></pre>
		</div>{/if}
</div>
