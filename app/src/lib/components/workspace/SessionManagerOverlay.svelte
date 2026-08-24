<script lang="ts">
	import { isImageIcon } from './project-management.svelte';
	import type { WorkspaceNavigation } from './navigation.svelte';
	import SessionManagerDialog from './SessionManagerDialog.svelte';
	let { navigation }: { navigation: WorkspaceNavigation } = $props();
</script>

<SessionManagerDialog
	bind:dialog={navigation.editSessionDialog}
	bind:title={navigation.sessionTitle}
	bind:pinned={navigation.sessionPinned}
	bind:archived={navigation.sessionArchived}
	bind:folder={navigation.sessionFolder}
	bind:tags={navigation.sessionTags}
	bind:icon={navigation.sessionIcon}
	bind:emojiOpen={navigation.sessionEmojiPickerOpen}
	error={navigation.sessionEditError}
	saving={navigation.sessionSaving}
	onimage={navigation.chooseSessionImage}
	onsave={navigation.saveSession}
	onduplicate={navigation.duplicateSession}
	ondelete={navigation.deleteSession}
	onexport={navigation.exportSession}
	isImage={isImageIcon}
	iconPreview={navigation.sessionIconPreview}
/>
