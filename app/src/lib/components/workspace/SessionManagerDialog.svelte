<script lang="ts">
	import Archive from '~icons/lucide/archive';
	import ArchiveRestore from '~icons/lucide/archive-restore';
	import ArrowDown from '~icons/lucide/arrow-down';
	import ArrowUp from '~icons/lucide/arrow-up';
	import Copy from '~icons/lucide/copy';
	import Download from '~icons/lucide/download';
	import FileJson from '~icons/lucide/file-json';
	import Pin from '~icons/lucide/pin';
	import PinOff from '~icons/lucide/pin-off';
	import Trash2 from '~icons/lucide/trash-2';
	import Upload from '~icons/lucide/upload';
	import X from '~icons/lucide/x';
	import type { SessionHarness } from '$lib/session-harness';
	import type { ChatBackground } from './chat-background';
	import ChatBackgroundPicker from './ChatBackgroundPicker.svelte';
	let {
		menu = $bindable(),
		title = $bindable(),
		pinned = $bindable(),
		archived = $bindable(),
		folder = $bindable(),
		sections,
		tags = $bindable(),
		error,
		saving,
		canDuplicate,
		harness,
		onicon,
		onsave,
		onduplicate,
		onmoveup,
		onmovedown,
		canMoveUp,
		canMoveDown,
		ondelete,
		onexport,
		isImage,
		iconPreview,
		background,
		onbackground,
		onbackgroundupload
	}: {
		menu?: HTMLElement;
		title: string;
		pinned: boolean;
		archived: boolean;
		folder: string;
		sections: string[];
		tags: string;
		error: string;
		saving: boolean;
		canDuplicate: boolean;
		harness?: SessionHarness;
		onicon: (event: MouseEvent) => void;
		onsave: () => void | Promise<void>;
		onduplicate: () => void;
		onmoveup: () => void;
		onmovedown: () => void;
		canMoveUp: boolean;
		canMoveDown: boolean;
		ondelete: () => void;
		onexport: (format: 'markdown' | 'json') => void;
		isImage: (icon: string | null) => boolean;
		iconPreview: () => string;
		background: ChatBackground | null;
		onbackground: (background: ChatBackground | null) => void;
		onbackgroundupload: (event: Event) => void;
	} = $props();
	let harnessName = $derived(harness === 'opencode' ? 'OpenCode' : 'Hermes');
</script>

<div
	bind:this={menu}
	popover="auto"
	role="dialog"
	aria-labelledby="session-options-title"
	class="session-manager-popover fixed m-0 max-h-[min(680px,calc(100dvh-24px))] w-[min(380px,calc(100vw-24px))] overflow-auto rounded-xl border border-border bg-card p-2 text-foreground shadow-2xl"
>
	<header class="sticky top-0 z-10 flex items-center gap-3 bg-card px-2 py-2">
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
			onclick={() => menu?.hidePopover()}><X width={17} height={17} aria-hidden="true" /></button
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
				>Move to section <span class="sr-only">optional</span><input
					class="min-h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
					bind:value={folder}
					list="session-sections"
					maxlength="100"
					placeholder="No section"
					onchange={onsave}
				/><datalist id="session-sections">
					{#each sections as section}<option value={section}></option>{/each}
				</datalist></label
			><label class="grid gap-1.5 text-xs font-medium"
				>Tags <span class="sr-only">comma separated, optional</span><input
					class="min-h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
					bind:value={tags}
					placeholder="release, blocked"
					onchange={onsave}
				/></label
			>
		</div>
		<fieldset class="grid gap-2 border-t border-border pt-3">
			<legend class="text-xs font-medium">Chat background</legend>
			<ChatBackgroundPicker
				value={background}
				inherit
				onselect={onbackground}
				onupload={onbackgroundupload}
			/>
			<p class="text-[11px] text-muted-foreground">
				General follows the App settings choice. Session overrides stay in this browser.
			</p>
		</fieldset>
		<div class="grid grid-cols-2 gap-2 border-y border-border py-2">
			<button
				class="flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent"
				class:bg-accent={pinned}
				aria-label={pinned ? 'Unpin session' : 'Pin session'}
				aria-pressed={pinned}
				onclick={() => {
					pinned = !pinned;
					void onsave();
				}}
				>{#if pinned}<PinOff width={16} height={16} aria-hidden="true" /> Unpin{:else}<Pin
						width={16}
						height={16}
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
				}}
				>{#if archived}<ArchiveRestore width={16} height={16} aria-hidden="true" /> Restore{:else}<Archive
						width={16}
						height={16}
						aria-hidden="true"
					/> Archive{/if}</button
			>
		</div>

		<section
			aria-labelledby="session-actions-heading"
			class="grid gap-1 border-t border-border pt-2"
		>
			<h3 id="session-actions-heading" class="px-2 py-1 text-xs font-medium text-muted-foreground">
				Actions
			</h3>
			<div class="grid grid-cols-2 gap-1">
				<button class="session-menu-action" disabled={!canMoveUp} onclick={onmoveup}
					><ArrowUp width={16} height={16} aria-hidden="true" /> Move up</button
				><button class="session-menu-action" disabled={!canMoveDown} onclick={onmovedown}
					><ArrowDown width={16} height={16} aria-hidden="true" /> Move down</button
				>
			</div>
			<button
				class="session-menu-action"
				disabled
				title={`${harnessName} ACP does not provide a Session import seam`}
				><Upload width={16} height={16} aria-hidden="true" /> Import unavailable</button
			><button class="session-menu-action" onclick={() => onexport('markdown')}
				><Download width={16} height={16} aria-hidden="true" /> Export Markdown</button
			><button class="session-menu-action" onclick={() => onexport('json')}
				><FileJson width={16} height={16} aria-hidden="true" /> Export JSON</button
			><button
				class="session-menu-action"
				disabled={saving || !canDuplicate}
				title={canDuplicate ? 'Duplicate Session' : `${harnessName} does not support Session duplication`}
				onclick={onduplicate}><Copy width={16} height={16} aria-hidden="true" /> Duplicate</button
			><button
				class="session-menu-action mt-1 border-t border-border text-destructive"
				disabled={saving}
				onclick={ondelete}><Trash2 width={16} height={16} aria-hidden="true" /> Remove</button
			>
		</section>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	</div>
</div>
