<script lang="ts">
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { formatFileSize, type DeleteImpact } from './file-types';

	let {
		actionOpen,
		deleteOpen,
		action,
		actionPath,
		deleteImpact,
		deleteConfirmation,
		busy,
		onsubmit,
		ondelete,
		onclose,
		onactionpath,
		ondeleteconfirmation
	}: {
		actionOpen: boolean;
		deleteOpen: boolean;
		action: 'file' | 'folder' | 'move';
		actionPath: string;
		deleteImpact: DeleteImpact | null;
		deleteConfirmation: string;
		busy: boolean;
		onsubmit: (event: SubmitEvent) => void;
		ondelete: () => void;
		onclose: (kind: 'guard' | 'action' | 'delete') => void;
		onactionpath: (value: string) => void;
		ondeleteconfirmation: (value: string) => void;
	} = $props();
	let actionDialog: HTMLDialogElement;
	let deleteDialog: HTMLDialogElement;
	$effect(() => {
		if (actionOpen && !actionDialog.open) actionDialog.showModal();
		else if (!actionOpen && actionDialog.open) actionDialog.close();
	});
	$effect(() => {
		if (deleteOpen && !deleteDialog.open) deleteDialog.showModal();
		else if (!deleteOpen && deleteDialog.open) deleteDialog.close();
	});
	function close(dialog: HTMLDialogElement, kind: 'guard' | 'action' | 'delete') {
		dialog.close();
		onclose(kind);
	}
</script>

<dialog
	bind:this={actionDialog}
	class="m-auto w-[min(92vw,460px)] rounded-xl border border-border bg-card p-5 text-foreground backdrop:bg-black/70"
	aria-labelledby="file-action-title"
	oncancel={() => onclose('action')}
>
	<form {onsubmit}>
		<h2 id="file-action-title" class="font-semibold">
			{action === 'move'
				? 'Rename or move file'
				: action === 'folder'
					? 'Create folder'
					: 'Create file'}
		</h2>
		<label class="my-4 block text-sm"
			>Project-relative path<Input
				class="mt-1"
				required
				value={actionPath}
				oninput={(event) => onactionpath((event.currentTarget as HTMLInputElement).value)}
			/></label
		>
		<div class="flex justify-end gap-2">
			<Button type="button" variant="outline" onclick={() => close(actionDialog, 'action')}
				>Cancel</Button
			><Button type="submit" disabled={busy}>{action === 'move' ? 'Move' : 'Create'}</Button>
		</div>
	</form>
</dialog>
<dialog
	bind:this={deleteDialog}
	class="m-auto w-[min(92vw,520px)] rounded-xl border border-border bg-card p-5 text-foreground backdrop:bg-black/70"
	aria-labelledby="delete-file-title"
	oncancel={() => onclose('delete')}
>
	<h2 id="delete-file-title" class="font-semibold">Delete exact file impact?</h2>
	{#if deleteImpact}<p class="my-3 text-sm">
			Deletes {deleteImpact.files} files, {deleteImpact.directories} directories, {formatFileSize(
				deleteImpact.bytes
			)}. Cannot be undone.
		</p>
		<label class="block text-sm"
			>Type exact confirmation<Input
				class="mt-1 font-mono text-xs"
				value={deleteConfirmation}
				oninput={(event) => ondeleteconfirmation((event.currentTarget as HTMLInputElement).value)}
				placeholder={deleteImpact.confirmation}
			/></label
		>
		<div class="mt-4 flex justify-end gap-2">
			<Button variant="outline" onclick={() => close(deleteDialog, 'delete')}>Cancel</Button><Button
				variant="destructive"
				disabled={deleteConfirmation !== deleteImpact.confirmation || busy}
				onclick={ondelete}>Delete exact impact</Button
			>
		</div>{/if}
</dialog>
