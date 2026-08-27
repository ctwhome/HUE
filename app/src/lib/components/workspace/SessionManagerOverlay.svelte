<script lang="ts">
	import {
		CHAT_BACKGROUND_EVENT,
		readChatBackground,
		resizeChatBackground,
		writeChatBackground,
		type ChatBackground
	} from './chat-background';
	import { isImageIcon } from './project-management.svelte';
	import IconEditorPopover from '$lib/components/IconEditorPopover.svelte';
	import type { WorkspaceNavigation } from './navigation.svelte';
	import SessionManagerDialog from './SessionManagerDialog.svelte';
	let { navigation, canDuplicate }: { navigation: WorkspaceNavigation; canDuplicate: boolean } =
		$props();
	let background = $state<ChatBackground | null>(null);
	$effect(() => {
		const sessionId = navigation.editingSession?.sessionId;
		if (sessionId && typeof localStorage !== 'undefined')
			background = readChatBackground(localStorage, sessionId);
	});
	function setBackground(next: ChatBackground | null) {
		const sessionId = navigation.editingSession?.sessionId;
		if (!sessionId) return;
		try {
			writeChatBackground(localStorage, sessionId, next);
			background = next;
			navigation.sessionEditError = '';
			window.dispatchEvent(new CustomEvent(CHAT_BACKGROUND_EVENT, { detail: { sessionId } }));
		} catch {
			navigation.sessionEditError = 'Could not save the background in this browser';
		}
	}
	async function uploadBackground(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			setBackground({ kind: 'custom', image: await resizeChatBackground(file) });
		} catch (cause) {
			navigation.sessionEditError = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<SessionManagerDialog
	bind:menu={navigation.editSessionMenu}
	bind:title={navigation.sessionTitle}
	bind:pinned={navigation.sessionPinned}
	bind:archived={navigation.sessionArchived}
	bind:folder={navigation.sessionFolder}
	sections={navigation.sessionSections}
	bind:tags={navigation.sessionTags}
	error={navigation.sessionEditError}
	saving={navigation.sessionSaving}
	{canDuplicate}
	onicon={navigation.openSessionIconEditor}
	onsave={navigation.saveSession}
	onduplicate={navigation.duplicateSession}
	ondelete={navigation.deleteSession}
	onexport={navigation.exportSession}
	isImage={isImageIcon}
	iconPreview={navigation.sessionIconPreview}
	{background}
	onbackground={setBackground}
	onbackgroundupload={uploadBackground}
/>

<IconEditorPopover
	bind:popover={navigation.sessionIconMenu}
	anchor={navigation.sessionIconAnchor}
	label="Session"
	onimage={navigation.chooseSessionImage}
	onselect={(icon) => {
		navigation.sessionIcon = icon;
		void navigation.saveSessionIcon();
	}}
/>
