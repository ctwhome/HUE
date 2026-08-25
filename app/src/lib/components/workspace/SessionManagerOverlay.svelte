<script lang="ts">
	import { isImageIcon } from './project-management.svelte';
	import IconEditorPopover from '$lib/components/IconEditorPopover.svelte';
	import type { WorkspaceNavigation } from './navigation.svelte';
	import PromptLibraryDialog from './PromptLibraryDialog.svelte';
	import SessionManagerDialog from './SessionManagerDialog.svelte';
	let {
		navigation,
		profile,
		promptLibraryAvailable
	}: {
		navigation: WorkspaceNavigation;
		profile: string;
		promptLibraryAvailable: boolean;
	} = $props();
	let promptLibraryDialog = $state<HTMLDialogElement>();
	let promptLibraryLoading = $state(false);
	async function openPromptLibrary() {
		promptLibraryDialog?.showModal();
		promptLibraryLoading = true;
		await navigation.loadWorkflows();
		promptLibraryLoading = false;
	}
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
	{profile}
	{promptLibraryAvailable}
	onicon={navigation.openSessionIconEditor}
	onsave={navigation.saveSession}
	onduplicate={navigation.duplicateSession}
	ondelete={navigation.deleteSession}
	onexport={navigation.exportSession}
	onprompts={() => void openPromptLibrary()}
	isImage={isImageIcon}
	iconPreview={navigation.sessionIconPreview}
/>

<PromptLibraryDialog
	id="workspace-prompts"
	bind:dialog={promptLibraryDialog}
	loading={promptLibraryLoading}
	workflows={navigation.workflows}
	bind:name={navigation.workflowName}
	bind:prompt={navigation.workflowPrompt}
	onsubmit={navigation.addWorkflow}
	onrun={navigation.runWorkflow}
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
