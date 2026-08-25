<script lang="ts">
	import {
		Archive,
		ArchiveRestore,
		BookOpenText,
		Copy,
		Download,
		FileJson,
		Pin,
		PinOff,
		Trash2,
		Upload,
		UserRound,
		X
	} from 'lucide-svelte';
	let {
		menu = $bindable(),
		title = $bindable(),
		pinned = $bindable(),
		archived = $bindable(),
		folder = $bindable(),
		tags = $bindable(),
		error,
		saving,
		profile,
		promptLibraryAvailable,
		onicon,
		onsave,
		onduplicate,
		ondelete,
		onexport,
		onprompts,
		isImage,
		iconPreview
	}: {
		menu?: HTMLElement;
		title: string;
		pinned: boolean;
		archived: boolean;
		folder: string;
		tags: string;
		error: string;
		saving: boolean;
		profile: string;
		promptLibraryAvailable: boolean;
		onicon: (event: MouseEvent) => void;
		onsave: () => void | Promise<void>;
		onduplicate: () => void;
		ondelete: () => void;
		onexport: (format: 'markdown' | 'json') => void;
		onprompts: () => void;
		isImage: (icon: string | null) => boolean;
		iconPreview: () => string;
	} = $props();
</script>

<div
	bind:this={menu}
	popover="auto"
	role="dialog"
	aria-labelledby="session-options-title"
	class="session-manager-popover fixed m-0 max-h-[min(680px,calc(100dvh-24px))] w-[min(380px,calc(100vw-24px))] overflow-auto rounded-xl border border-border bg-card p-2 text-foreground shadow-2xl"
>
	<header class="flex items-center gap-3 px-2 py-2">
		<button
			class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-xl hover:ring-2 hover:ring-ring"
			aria-label="Change session icon"
			title="Change session icon"
			onclick={onicon}
		>
			{#if isImage(iconPreview())}<img src={iconPreview()} alt="" />{:else}<span
					>{iconPreview()}</span
				>{/if}
		</button>
		<div class="min-w-0 flex-1">
			<h2 id="session-options-title" class="truncate text-sm font-semibold">Session options</h2>
			<p class="text-xs text-muted-foreground">{saving ? 'Saving...' : 'Saved automatically'}</p>
		</div>
		<button
			class="grid size-9 place-items-center rounded-lg hover:bg-accent"
			aria-label="Close session options"
			title="Close"
			onclick={() => menu?.hidePopover()}><X size={17} aria-hidden="true" /></button
		>
	</header>

	<div class="grid gap-3 px-2 pb-2">
		<label class="grid gap-1.5 text-xs font-medium"
			>Title<input
				class="min-h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
				bind:value={title}
				maxlength="200"
				required
				onchange={onsave}
			/></label
		>
		<div class="grid grid-cols-2 gap-2">
			<label class="grid gap-1.5 text-xs font-medium"
				>Folder <span class="sr-only">optional</span><input
					class="min-h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
					bind:value={folder}
					maxlength="100"
					placeholder="Optional"
					onchange={onsave}
				/></label
			><label class="grid gap-1.5 text-xs font-medium"
				>Tags <span class="sr-only">comma separated, optional</span><input
					class="min-h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
					bind:value={tags}
					placeholder="release, blocked"
					onchange={onsave}
				/></label
			>
		</div>
		<section class="grid gap-1 border-t border-border pt-2" aria-label="Hermes context">
			<div class="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm" aria-label="Hermes profile">
				<UserRound size={16} aria-hidden="true" /><span class="text-muted-foreground">Profile</span><strong
					class="ml-auto font-medium">{profile}</strong
				>
			</div>
			{#if promptLibraryAvailable}<button
					class="session-menu-action"
					onclick={() => {
						menu?.hidePopover();
						onprompts();
					}}><BookOpenText size={16} aria-hidden="true" /> Prompt library</button
				>{/if}
		</section>

		<div class="grid grid-cols-2 gap-2 border-y border-border py-2">
			<button
				class="flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent"
				class:bg-accent={pinned}
				aria-label={pinned ? 'Unpin session' : 'Pin session'}
				aria-pressed={pinned}
				onclick={() => {
					pinned = !pinned;
					void onsave();
				}}>{#if pinned}<PinOff size={16} aria-hidden="true" /> Unpin{:else}<Pin
						size={16}
						aria-hidden="true"
					/> Pin{/if}</button
			><button
				class="flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent"
				class:bg-accent={archived}
				aria-label={archived ? 'Restore session' : 'Archive session'}
				aria-pressed={archived}
				onclick={() => {
					archived = !archived;
					void onsave();
				}}>{#if archived}<ArchiveRestore size={16} aria-hidden="true" /> Restore{:else}<Archive
						size={16}
						aria-hidden="true"
					/> Archive{/if}</button
			>
		</div>

		<section aria-labelledby="session-actions-heading" class="grid gap-1 border-t border-border pt-2">
			<h3 id="session-actions-heading" class="px-2 py-1 text-xs font-medium text-muted-foreground">
				Actions
			</h3>
			<button
				class="session-menu-action"
				disabled
				title="Hermes ACP does not provide a Session import seam"><Upload
					size={16}
					aria-hidden="true"
				/> Import unavailable</button
			><button class="session-menu-action" onclick={() => onexport('markdown')}><Download
					size={16}
					aria-hidden="true"
				/> Export Markdown</button
			><button class="session-menu-action" onclick={() => onexport('json')}><FileJson
					size={16}
					aria-hidden="true"
				/> Export JSON</button
			><button class="session-menu-action" disabled={saving} onclick={onduplicate}><Copy
					size={16}
					aria-hidden="true"
				/> Duplicate</button
			><button
				class="session-menu-action mt-1 border-t border-border text-destructive"
				disabled={saving}
				onclick={ondelete}><Trash2 size={16} aria-hidden="true" /> Remove</button
			>
		</section>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	</div>
</div>
