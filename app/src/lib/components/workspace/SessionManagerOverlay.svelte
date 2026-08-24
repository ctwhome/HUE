<script lang="ts">
	import { isImageIcon } from './project-management.svelte';
	import IconEditorPopover from '$lib/components/IconEditorPopover.svelte';
	import type { WorkspaceNavigation } from './navigation.svelte';
	import SessionManagerDialog from './SessionManagerDialog.svelte';
	let { navigation }: { navigation: WorkspaceNavigation } = $props();
</script>

<SessionManagerDialog
	bind:menu={navigation.editSessionMenu}
	bind:title={navigation.sessionTitle}
	bind:pinned={navigation.sessionPinned}
	bind:archived={navigation.sessionArchived}
	bind:folder={navigation.sessionFolder}
	bind:tags={navigation.sessionTags}
	error={navigation.sessionEditError}
	saving={navigation.sessionSaving}
	onicon={navigation.openSessionIconEditor}
	onsave={navigation.saveSession}
	onduplicate={navigation.duplicateSession}
	ondelete={navigation.deleteSession}
	onexport={navigation.exportSession}
	isImage={isImageIcon}
	iconPreview={navigation.sessionIconPreview}
/>

<IconEditorPopover
	bind:popover={navigation.sessionIconMenu}
	anchor={navigation.sessionIconAnchor}
	label="Session"
	onimage={navigation.chooseSessionImage}
	onselect={(icon) => {
		navigation.sessionIcon = icon;
		void navigation.saveSession();
	}}
/>
