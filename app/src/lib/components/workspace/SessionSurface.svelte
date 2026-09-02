<script lang="ts">
	import { untrack } from 'svelte';
	import { isTurnBusy, selectLatestPlan } from '$lib';
	import { renderMessageMarkdown } from '$lib/message-markdown';
	import type { WorkMode } from '$lib/work-mode';
	import Composer from './Composer.svelte';
	import Conversation from './Conversation.svelte';
	import { compactModelLabel } from './mobile-navigation';
	import type { WorkspaceNavigation } from './navigation.svelte';
	import type { SessionController } from './session-controller.svelte';
	import type { Project, Session, Workflow } from './types';

	let {
		controller,
		navigation,
		project,
		session,
		workflows,
		sessionLabel,
		mediaPath,
		onsubmit,
		oninput,
		onrunworkflow,
		unavailableRecovery = null,
		showContextUsage = true,
		ready = true
	}: {
		controller: SessionController;
		navigation: WorkspaceNavigation;
		project: Project | null;
		session: Session | null;
		workflows: Workflow[];
		sessionLabel: string;
		mediaPath: string;
		onsubmit: (event: SubmitEvent) => void | Promise<void>;
		oninput: (event: Event) => void;
		onrunworkflow: (workflow: Workflow) => void;
		unavailableRecovery?: string | null;
		showContextUsage?: boolean;
		ready?: boolean;
	} = $props();
	const sessionState = untrack(() => controller.sessionState);
	const transcriptFollow = untrack(() => controller.transcriptFollow);
	const messageState = untrack(() => controller.messageState);
	const runtimeState = untrack(() => controller.runtimeState);
	const voice = untrack(() => controller.voice);
	let timeline = $derived(sessionState.timeline);
	let runtime = $derived(sessionState.runtime);
</script>

<svelte:window onpagehide={messageState.saveCurrentDraft} />

<Conversation
	{timeline}
	{sessionLabel}
	messageNotice={messageState.messageNotice}
	agentLabel={compactModelLabel(
		runtime.models?.currentModelId ?? '',
		runtimeState.currentModel()?.name ?? runtime.models?.currentModelId ?? 'Hermes'
	)}
	busy={isTurnBusy(sessionState.delivery)}
	{mediaPath}
	renderMarkdown={renderMessageMarkdown}
	onedit={messageState.editMessage}
	oncopy={messageState.copyMessage}
	oncopycode={messageState.copyCode}
	oncopytable={messageState.copyTable}
	oninteraction={messageState.respondToInteraction}
	onmedia={messageState.openMedia}
	onretrylast={messageState.retryLastResponse}
	onquote={messageState.addReviewContext}
	bind:element={transcriptFollow.element}
	follow={transcriptFollow.follow}
/>
{#if unavailableRecovery}<div
		class="m-4 rounded-lg border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-4 py-3 text-sm text-[var(--warning)]"
		role="status"
	>
		{unavailableRecovery}
	</div>{:else}<Composer
		composer={messageState.composer}
		plan={selectLatestPlan(timeline)}
		{timeline}
		renderMarkdown={renderMessageMarkdown}
		bind:composerElement={messageState.composerElement}
		bind:draggingImages={messageState.draggingImages}
		bind:images={messageState.images}
		bind:attachments={messageState.attachments}
		reviewContexts={messageState.reviewContexts}
		delivery={sessionState.delivery}
		pendingEnvelope={messageState.pendingEnvelope}
		queuedMessages={sessionState.queuedMessages}
		editingQueuedMessageId={messageState.editingQueuedMessageId}
		commandIndex={messageState.commandIndex}
		callActive={voice.active}
		voiceMessageOnly={voice.messageOnly}
		callMuted={voice.muted}
		callStatus={voice.status}
		callError={voice.error}
		bind:voiceCancelElement={voice.cancelElement}
		bind:callMuteElement={voice.muteElement}
		bind:voiceMessageElement={voice.messageElement}
		bind:voiceStartElement={voice.startElement}
		{runtime}
		workMode={session?.workMode ?? ('autonomous' satisfies WorkMode)}
		workModeChanging={controller.workModeChanging}
		runtimeChanging={runtimeState.changing}
		promptLibraryAvailable={Boolean(project?.rootAvailable)}
		projectName={project?.name ?? ''}
		{workflows}
		bind:workflowName={navigation.workflowName}
		bind:workflowPrompt={navigation.workflowPrompt}
		bind:workflowFolder={navigation.workflowFolder}
		bind:workflowProfile={navigation.workflowProfile}
		bind:workflowBundle={navigation.workflowBundle}
		stopping={messageState.stopping}
		showScrollToLatest={timeline.length > 0 && transcriptFollow.showScrollToLatest}
		busy={isTurnBusy(sessionState.delivery)}
		{onsubmit}
		ondrop={messageState.handleDrop}
		onpaste={messageState.handlePaste}
		{oninput}
		onkeydown={messageState.handleComposerKeydown}
		onimages={messageState.handleImageInput}
		oncontextcomment={messageState.updateReviewComment}
		onremovecontext={messageState.removeReviewContext}
		onvoiceMessage={voice.startMessage}
		onvoiceCall={voice.startCall}
		onmute={voice.toggleMute}
		oninterrupt={voice.interrupt}
		onendcall={() => voice.end(false)}
		onstop={messageState.stopTurn}
		onretry={messageState.retryPendingMessage}
		oneditqueued={messageState.editQueuedMessage}
		oncommand={messageState.chooseCommand}
		onmodel={runtimeState.selectModel}
		onruntime={runtimeState.change}
		onconfig={runtimeState.changeConfig}
		onworkmode={controller.changeWorkMode}
		onloadworkflows={navigation.loadWorkflows}
		onworkflow={navigation.addWorkflow}
		onupdateworkflow={navigation.updateWorkflow}
		ondeleteworkflow={navigation.deleteWorkflow}
		onduplicateworkflow={navigation.duplicateWorkflow}
		onfavoritecatalog={navigation.favoriteCatalogPrompt}
		{onrunworkflow}
		onscrolllatest={transcriptFollow.scrollToLatest}
		onimprove={messageState.improvePrompt}
		matchingCommands={messageState.matchingCommands}
		contextPercent={runtimeState.contextPercent}
		{showContextUsage}
		{ready}
	/>{/if}
