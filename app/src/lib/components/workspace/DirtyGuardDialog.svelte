<script lang="ts">
	import Button from '../ui/Button.svelte';
	let { open, onkeep, ondiscard }: { open: boolean; onkeep: () => void; ondiscard: () => void } =
		$props();
	let dialog: HTMLDialogElement;
	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class="m-auto rounded-xl border border-border bg-card p-5 text-foreground backdrop:bg-black/70"
	aria-labelledby="workspace-unsaved-title"
	oncancel={onkeep}
>
	<h2 id="workspace-unsaved-title" class="font-semibold">Discard unsaved changes?</h2>
	<p class="my-3 text-sm">Current editor has unsaved changes.</p>
	<div class="flex justify-end gap-2">
		<Button variant="outline" onclick={onkeep}>Keep editing</Button><Button
			variant="destructive"
			onclick={ondiscard}>Discard changes</Button
		>
	</div>
</dialog>
