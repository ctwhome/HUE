<script lang="ts">
	import CodeXml from '~icons/lucide/code-xml';
	import Copy from '~icons/lucide/copy';
	import Download from '~icons/lucide/download';
	import WrapText from '~icons/lucide/wrap-text';

	let {
		kind,
		oncopy,
		ontogglewrap = () => {},
		ontogglesource = () => {},
		ondownload = () => {}
	}: {
		kind: 'code' | 'table' | 'mermaid';
		oncopy: () => void;
		ontogglewrap?: (wrapped: boolean) => void;
		ontogglesource?: (shown: boolean) => void;
		ondownload?: () => void;
	} = $props();
	let wrapped = $state(false);
	let sourceShown = $state(false);
	let initialized = false;
	$effect(() => {
		if (initialized) return;
		wrapped = kind === 'table';
		initialized = true;
	});
</script>

<div class="markdown-icon-toolbar">
	<button
		type="button"
		onclick={oncopy}
		aria-label={kind === 'table'
			? 'Copy table'
			: kind === 'mermaid'
				? 'Copy Mermaid source'
				: 'Copy code'}
		title={kind === 'table'
			? 'Copy table'
			: kind === 'mermaid'
				? 'Copy Mermaid source'
				: 'Copy code'}
	>
		<Copy width={15} height={15} aria-hidden="true" />
	</button>
	{#if kind === 'table' || kind === 'code'}<button
			type="button"
			aria-label={kind === 'table' ? 'Wrap table cells' : 'Wrap code'}
			title={kind === 'table' ? 'Wrap table cells' : 'Wrap code'}
			aria-pressed={wrapped}
			onclick={() => {
				wrapped = !wrapped;
				ontogglewrap(wrapped);
			}}><WrapText width={15} height={15} aria-hidden="true" /></button
		>{:else if kind === 'mermaid'}<button
			type="button"
			aria-label="Show Mermaid source"
			title="Show Mermaid source"
			aria-pressed={sourceShown}
			onclick={() => {
				sourceShown = !sourceShown;
				ontogglesource(sourceShown);
			}}><CodeXml width={15} height={15} aria-hidden="true" /></button
		><button
			type="button"
			onclick={ondownload}
			aria-label="Download Mermaid diagram"
			title="Download Mermaid diagram"
			><Download width={15} height={15} aria-hidden="true" /></button
		>{/if}
</div>
