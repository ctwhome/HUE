<script lang="ts">
	import { Archive, Copy, Pin, Trash2, X } from 'lucide-svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';

	let {
		dialog = $bindable(),
		title = $bindable(),
		pinned = $bindable(),
		archived = $bindable(),
		folder = $bindable(),
		tags = $bindable(),
		icon = $bindable(),
		emojiOpen = $bindable(),
		error,
		saving,
		onimage,
		onsave,
		onduplicate,
		ondelete,
		onexport,
		isImage,
		iconPreview
	}: {
		dialog?: HTMLDialogElement;
		title: string;
		pinned: boolean;
		archived: boolean;
		folder: string;
		tags: string;
		icon: string | null;
		emojiOpen: boolean;
		error: string;
		saving: boolean;
		onimage: (event: Event) => void;
		onsave: (event: SubmitEvent) => void;
		onduplicate: () => void;
		ondelete: () => void;
		onexport: (format: 'markdown' | 'json') => void;
		isImage: (icon: string | null) => boolean;
		iconPreview: () => string;
	} = $props();
</script>

<dialog
	bind:this={dialog}
	class="add-project-dialog edit-project-dialog fixed m-0 max-h-[calc(100dvh-32px)] w-[min(460px,calc(100vw-32px))] overflow-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-2xl backdrop:bg-black/60"
	aria-labelledby="edit-session-title"
	onclick={(event) => event.target === event.currentTarget && dialog?.close()}
>
	<header class="dialog-header">
		<div>
			<h2 id="edit-session-title">Edit Session</h2>
			<p>Rename, organize, duplicate, archive, or remove this HUE Session.</p>
		</div>
		<button
			class="icon-button"
			aria-label="Close session manager"
			title="Close session manager"
			onclick={() => dialog?.close()}><X size={18} aria-hidden="true" /></button
		>
	</header>
	<form onsubmit={onsave}>
		<div class="dialog-body">
			<label>Title<input bind:value={title} maxlength="200" required /></label>
			<label
				>Folder <span class="text-muted-foreground">optional</span><input
					bind:value={folder}
					maxlength="100"
				/></label
			>
			<label
				>Tags <span class="text-muted-foreground">comma separated, optional</span><input
					bind:value={tags}
					placeholder="release, blocked"
				/></label
			>
			<div class="grid grid-cols-2 gap-2 py-2">
				<label class="flex min-h-11 items-center gap-2"
					><input bind:checked={pinned} type="checkbox" /><Pin size={16} aria-hidden="true" /> Pinned</label
				><label class="flex min-h-11 items-center gap-2"
					><input bind:checked={archived} type="checkbox" /><Archive size={16} aria-hidden="true" /> Archived</label
				>
			</div>
			<fieldset class="project-icon-field m-0 min-w-0 border-0 p-0">
				<legend>Session icon</legend>
				<div
					class="project-icon-editor mt-2 grid grid-cols-[58px_minmax(0,1fr)] items-center gap-3"
				>
					<div
						class="project-icon-preview grid size-[58px] place-items-center overflow-hidden rounded-xl border border-border bg-background text-3xl"
					>
						{#if isImage(iconPreview())}<img
								src={iconPreview()}
								alt="Session icon preview"
							/>{:else}<span>{iconPreview()}</span>{/if}
					</div>
					<div class="project-icon-options grid gap-2">
						<div class="project-icon-upload flex gap-1.5">
							<button
								type="button"
								aria-label="Choose session emoji"
								title="Choose session emoji"
								onclick={() => (emojiOpen = !emojiOpen)}>Choose emoji</button
							><label title="Choose a custom session image"
								><span>Choose image</span><input
									type="file"
									accept="image/png,image/jpeg,image/gif,image/webp"
									aria-label="Session icon image"
									onchange={onimage}
								/></label
							><button
								type="button"
								title="Use automatic session icon"
								onclick={() => (icon = null)}>Automatic</button
							>
						</div>
					</div>
				</div>
				{#if emojiOpen}<EmojiPicker
						onselect={(emoji) => {
							icon = emoji;
							emojiOpen = false;
						}}
					/>{/if}
			</fieldset>
			{#if error}<p class="directory-error text-sm text-destructive" role="alert">{error}</p>{/if}
		</div>
		<footer
			class="dialog-footer edit-project-actions session-icon-actions flex flex-wrap justify-end gap-3"
		>
			<button
				type="button"
				class="min-h-11"
				disabled
				title="Hermes ACP does not provide a Session import seam">Import unavailable</button
			>
			<button
				type="button"
				class="min-h-11"
				title="Export Session as Markdown"
				onclick={() => onexport('markdown')}>Export Markdown</button
			><button
				type="button"
				class="min-h-11"
				title="Export Session as JSON"
				onclick={() => onexport('json')}>Export JSON</button
			><button
				type="button"
				class="min-h-11"
				title="Duplicate Session"
				disabled={saving}
				onclick={onduplicate}><Copy size={16} aria-hidden="true" /> Duplicate</button
			><span class="destructive-separator"></span><button
				type="button"
				class="min-h-11 text-destructive"
				title="Remove Session"
				disabled={saving}
				onclick={ondelete}><Trash2 size={16} aria-hidden="true" /> Remove</button
			><button type="submit" class="min-h-11" title="Save Session changes" disabled={saving}
				>Save changes</button
			>
		</footer>
	</form>
</dialog>
