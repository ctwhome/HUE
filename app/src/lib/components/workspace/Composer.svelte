<script lang="ts">
	import ArrowDown from '~icons/lucide/arrow-down';
	import CircleHelp from '~icons/lucide/circle-help';
	import BookOpenText from '~icons/lucide/book-open-text';
	import Ellipsis from '~icons/lucide/ellipsis';
	import GripVertical from '~icons/lucide/grip-vertical';
	import Mic from '~icons/lucide/mic';
	import MicOff from '~icons/lucide/mic-off';
	import Paperclip from '~icons/lucide/paperclip';
	import PhoneCall from '~icons/lucide/phone-call';
	import PhoneOff from '~icons/lucide/phone-off';
	import Send from '~icons/lucide/send';
	import Square from '~icons/lucide/square';
	import UserRound from '~icons/lucide/user-round';
	import X from '~icons/lucide/x';
	import {
		selectThinkingTimeline,
		type WorkspacePlanEntry,
		type WorkspaceTimelineItem
	} from '$lib';
	import {
		reviewContextLimits,
		type ImageAttachment,
		type InputAttachment,
		type ReviewContext
	} from '$lib/message-content';
	import ModelPicker from '../ModelPicker.svelte';
	import SessionOptionPicker from '../SessionOptionPicker.svelte';
	import CurrentTask from './CurrentTask.svelte';
	import PromptLibraryDialog from './PromptLibraryDialog.svelte';
	import ThinkingDialog from './ThinkingDialog.svelte';
	import type {
		HermesCommand as Command,
		HermesRuntime as Runtime,
		QueuedMessage,
		Workflow
	} from './types';
	import type { WorkMode } from '$lib/work-mode';
	import type { CatalogPrompt } from '$lib/prompt-catalog';

	let {
		composer,
		plan,
		timeline,
		renderMarkdown,
		composerElement = $bindable(),
		draggingImages = $bindable(),
		images = $bindable(),
		attachments = $bindable(),
		reviewContexts,
		delivery,
		pendingEnvelope,
		queuedMessages,
		editingQueuedMessageId,
		commandIndex,
		callActive,
		voiceMessageOnly,
		callMuted,
		callStatus,
		callError,
		voiceCancelElement = $bindable(),
		callMuteElement = $bindable(),
		voiceMessageElement = $bindable(),
		voiceStartElement = $bindable(),
		runtime,
		workMode,
		workModeChanging,
		runtimeChanging,
		promptLibraryAvailable,
		projectName,
		workflows,
		workflowName = $bindable(),
		workflowPrompt = $bindable(),
		workflowFolder = $bindable(),
		workflowProfile = $bindable(),
		workflowWorkMode = $bindable(),
		stopping,
		showScrollToLatest,
		onsubmit,
		ondrop,
		onpaste,
		oninput,
		onkeydown,
		onimages,
		oncontextcomment,
		onremovecontext,
		onvoiceMessage,
		onvoiceCall,
		onmute,
		oninterrupt,
		onendcall,
		onstop,
		onretry,
		oneditqueued,
		oncommand,
		onmodel,
		onruntime,
		onconfig,
		onworkmode,
		onloadworkflows,
		onworkflow,
		onupdateworkflow,
		ondeleteworkflow,
		onduplicateworkflow,
		onfavoritecatalog,
		onrunworkflow,
		onscrolllatest,
		matchingCommands,
		contextPercent,
		showContextUsage = true,
		busy
	}: {
		composer: string;
		plan: WorkspacePlanEntry[];
		timeline: WorkspaceTimelineItem[];
		renderMarkdown: (text: string) => string;
		composerElement?: HTMLTextAreaElement;
		draggingImages: boolean;
		images: ImageAttachment[];
		attachments: InputAttachment[];
		reviewContexts: ReviewContext[];
		delivery: string;
		pendingEnvelope: object | null;
		queuedMessages: QueuedMessage[];
		editingQueuedMessageId: string;
		commandIndex: number;
		callActive: boolean;
		voiceMessageOnly: boolean;
		callMuted: boolean;
		callStatus: string;
		callError: string;
		voiceCancelElement?: HTMLButtonElement;
		callMuteElement?: HTMLButtonElement;
		voiceMessageElement?: HTMLButtonElement;
		voiceStartElement?: HTMLButtonElement;
		runtime: Runtime;
		workMode: WorkMode;
		workModeChanging: boolean;
		runtimeChanging: boolean;
		promptLibraryAvailable: boolean;
		projectName: string;
		workflows: Workflow[];
		workflowName: string;
		workflowPrompt: string;
		workflowFolder: string;
		workflowProfile: string;
		workflowWorkMode: WorkMode;
		stopping: boolean;
		showScrollToLatest: boolean;
		busy: boolean;
		onsubmit: (event: SubmitEvent) => void;
		ondrop: (event: DragEvent) => void;
		onpaste: (event: ClipboardEvent) => void;
		oninput: (event: Event) => void;
		onkeydown: (event: KeyboardEvent) => void;
		onimages: (event: Event) => void;
		oncontextcomment: (id: string, comment: string) => void;
		onremovecontext: (id: string) => void;
		onvoiceMessage: () => void;
		onvoiceCall: () => void;
		onmute: () => void;
		oninterrupt: () => void;
		onendcall: () => void;
		onstop: () => void;
		onretry: () => void;
		oneditqueued: (message: QueuedMessage) => void;
		oncommand: (command: Command) => void;
		onmodel: (id: string) => void;
		onruntime: (kind: 'modelId' | 'modeId', value: string) => void;
		onconfig: (configId: string, value: string | boolean) => void;
		onworkmode: (value: WorkMode) => void;
		onloadworkflows: (includeArchived?: boolean) => Promise<void>;
		onworkflow: (event: SubmitEvent) => boolean | void | Promise<boolean | void>;
		onupdateworkflow: (
			workflow: Workflow,
			patch: Partial<
				Pick<
					Workflow,
					'name' | 'prompt' | 'folder' | 'favorite' | 'profile' | 'workMode' | 'archived'
				>
			>
		) => Promise<boolean>;
		ondeleteworkflow: (workflow: Workflow) => Promise<boolean>;
		onduplicateworkflow: (workflow: Workflow) => Promise<boolean>;
		onfavoritecatalog: (prompt: CatalogPrompt) => Promise<boolean>;
		onrunworkflow: (workflow: Workflow) => void;
		onscrolllatest: (behavior: ScrollBehavior) => void;
		matchingCommands: () => Command[];
		contextPercent: () => number | null;
		showContextUsage?: boolean;
	} = $props();
	const instanceId = $props.id();
	const workModeOptions = [
		{ value: 'autonomous', name: 'Autonomous', description: 'Hermes works independently.' },
		{ value: 'live', name: 'Live', description: 'Collaborate turn by turn.' }
	];
	type SelectConfig = Extract<NonNullable<Runtime['configOptions']>[number], { type: 'select' }>;
	let reasoning = $derived(
		runtime.configOptions?.find(
			(option): option is SelectConfig =>
				option.type === 'select' && option.category === 'thought_level'
		)
	);
	let thinkingTimeline = $derived(selectThinkingTimeline(timeline));
	let thinkingOpen = $state(false);
	let tasksOpen = $state(false);
	let imagePrompts = $derived(runtime.capabilities?.promptImage === true);
	let promptLibraryDialog = $state<HTMLDialogElement>();
	let promptLibraryLoading = $state(false);
	let optionsOpen = $state(false);
	let optionsButton = $state<HTMLButtonElement>();
	let optionsMenu = $state<HTMLDivElement>();
	let commandMatches = $derived(matchingCommands());
	function flattenOptions(options: SelectConfig['options']) {
		return options.flatMap((option) => ('value' in option ? [option] : option.options));
	}
	function resizeComposer() {
		if (!composerElement) return;
		composerElement.style.height = '0';
		composerElement.style.height = `${Math.min(160, Math.max(44, composerElement.scrollHeight))}px`;
		composerElement.style.overflowY = composerElement.scrollHeight > 160 ? 'auto' : 'hidden';
	}
	function reserveComposerSpace(node: HTMLFormElement) {
		const parent = node.parentElement;
		const observer = new ResizeObserver(() => {
			const style = getComputedStyle(node);
			const height =
				node.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
			parent?.style.setProperty('--composer-height', `${height}px`);
		});
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
				parent?.style.removeProperty('--composer-height');
			}
		};
	}
	function handleComposerInput(event: Event) {
		oninput(event);
		resizeComposer();
	}
	$effect(() => {
		composer;
		resizeComposer();
	});

	async function openPromptLibrary() {
		optionsOpen = false;
		promptLibraryDialog?.showModal();
		if (promptLibraryAvailable) {
			promptLibraryLoading = true;
			await onloadworkflows();
			promptLibraryLoading = false;
		}
	}
	function insertPrompt(prompt: string) {
		if (!composerElement) return;
		composerElement.value = [composer.trimEnd(), prompt].filter(Boolean).join('\n\n');
		composerElement.dispatchEvent(new Event('input', { bubbles: true }));
		promptLibraryDialog?.close();
		queueMicrotask(() => composerElement?.focus());
	}
	function closeOptions(event: MouseEvent) {
		const target = event.target as Node;
		if (!optionsButton?.contains(target) && !optionsMenu?.contains(target)) optionsOpen = false;
	}
</script>

<svelte:window
	onresize={() => requestAnimationFrame(resizeComposer)}
	onclick={closeOptions}
	onkeydown={(event) => {
		if (event.key === 'Escape' && optionsOpen) {
			optionsOpen = false;
			optionsButton?.focus();
		}
	}}
/>

<form
	class="composer sticky bottom-0 mx-[clamp(10px,2vw,40px)] mb-4 rounded-lg border border-border bg-card/95 px-2.5 py-2 shadow-lg backdrop-blur-xl"
	class:dragging={draggingImages}
	use:reserveComposerSpace
	{onsubmit}
	ondragover={(event) => {
		event.preventDefault();
		draggingImages = true;
	}}
	ondragleave={() => (draggingImages = false)}
	{ondrop}
>
	<button
		type="button"
		class="scroll-to-latest absolute top-[-42px] left-1/2 grid size-9 -translate-x-1/2 translate-y-2 place-items-center rounded-full border border-border bg-card opacity-0 shadow-lg transition disabled:pointer-events-none"
		class:visible={showScrollToLatest}
		aria-label="Scroll to latest message"
		aria-hidden={!showScrollToLatest}
		title="Scroll to latest message"
		disabled={!showScrollToLatest}
		tabindex={showScrollToLatest ? 0 : -1}
		onclick={() => onscrolllatest('smooth')}
		><ArrowDown width={16} height={16} aria-hidden="true" /></button
	>
	{#if commandMatches.length}<div
			id={`${instanceId}-command-menu`}
			class="command-menu absolute right-0 bottom-[calc(100%+8px)] left-0 max-h-[min(360px,45vh)] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-xl"
			role="listbox"
			aria-label="Hermes commands"
		>
			{#each commandMatches as command, index}<button
					id={`${instanceId}-command-${index}`}
					type="button"
					role="option"
					aria-selected={index === commandIndex}
					title={command.description || `Use /${command.name}`}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => oncommand(command)}
				>
					<strong>/{command.name}{command.input ? ` ${command.input.hint}` : ''}</strong>
					<span>{command.description}</span>
				</button>{/each}
		</div>{/if}
	{#if queuedMessages.length}<section
			class="message-queue mb-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/50 p-2"
			aria-label="Queued messages"
		>
			<header><strong>Queued messages</strong><span>{queuedMessages.length}</span></header>
			{#each queuedMessages as message}<article>
					<div class="queued-copy flex min-w-0 flex-1 items-center gap-2 text-sm">
						<GripVertical
							class="queue-handle text-muted-foreground"
							width={16}
							height={16}
							aria-hidden="true"
						/>
						<span
							>{message.text ||
								`${message.images.length + message.attachments.length} file(s)`}</span
						>
						{#if message.images.length || message.attachments.length}<small
								>+{message.images.length + message.attachments.length} file(s)</small
							>{/if}
					</div>
					<div class="queue-actions flex shrink-0 items-center gap-1.5">
						<span>Waiting</span>
						<button
							type="button"
							aria-label="Edit queued message"
							title="Edit queued message"
							onclick={() => oneditqueued(message)}>Edit</button
						>
						<button
							type="button"
							aria-label="Send queued message now"
							title="Send queued message now"
							onclick={onstop}>Send now</button
						>
					</div>
				</article>{/each}
		</section>{/if}
	{#if images.length}<div class="attachment-list flex gap-2 overflow-x-auto px-1 pb-2">
			{#each images as image, index}<figure>
					<figcaption>{image.name}</figcaption>
					<img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
					<button
						type="button"
						aria-label={`Remove ${image.name}`}
						title={`Remove ${image.name}`}
						onclick={() => (images = images.filter((_, item) => item !== index))}
						><X width={14} height={14} aria-hidden="true" /></button
					>
				</figure>{/each}
		</div>{/if}
	{#if attachments.length}<div class="grid gap-1.5 px-1 pb-2" aria-label="Pending file attachments">
			{#each attachments as attachment, index}<article
					class="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
				>
					<span class="min-w-0 flex-1 truncate">{attachment.name}</span><small
						>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</small
					>
					<button
						type="button"
						class="grid min-h-11 min-w-11 place-items-center"
						aria-label={`Remove ${attachment.name}`}
						title={`Remove ${attachment.name}`}
						onclick={() => (attachments = attachments.filter((_, item) => item !== index))}
						><X width={14} height={14} aria-hidden="true" /></button
					>
				</article>{/each}
		</div>{/if}
	{#if reviewContexts.length}<section
			class="grid max-h-56 gap-1.5 overflow-y-auto px-1 pb-2"
			aria-label="Pending review context"
		>
			{#each reviewContexts as context}<article
					class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm"
				>
					<div class="min-w-0">
						<strong class="block truncate text-xs">{context.label}</strong>
						<p class="line-clamp-2 text-xs break-words text-muted-foreground">{context.content}</p>
					</div>
					<button
						type="button"
						class="grid min-h-11 min-w-11 place-items-center"
						aria-label={`Remove review context ${context.label}`}
						title={`Remove review context ${context.label}`}
						onclick={() => onremovecontext(context.id)}
						><X width={14} height={14} aria-hidden="true" /></button
					>
					<label class="col-span-2 grid gap-1 text-xs text-muted-foreground">
						Review comment
						<input
							class="min-h-11 min-w-0 rounded-md border border-input bg-background px-2 text-foreground"
							value={context.comment}
							maxlength={reviewContextLimits.maxCommentChars}
							placeholder="What should Hermes address?"
							oninput={(event) => oncontextcomment(context.id, event.currentTarget.value)}
						/>
					</label>
				</article>{/each}
		</section>{/if}
	{#if callActive}<section
			class="voice-call mb-1.5 flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-muted/50 p-2"
			aria-label={voiceMessageOnly ? 'Voice message controls' : 'Voice call controls'}
		>
			<span
				class="voice-call-state inline-flex items-center gap-2 text-sm font-bold capitalize"
				aria-live="polite"
			>
				<span class:active={!callMuted} aria-hidden="true"></span>
				{callMuted
					? 'Muted'
					: voiceMessageOnly && callStatus === 'listening'
						? 'recording'
						: callStatus}
			</span>
			{#if callError}<span
					class="voice-call-error mr-auto min-w-0 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-destructive"
					role="alert">{callError}</span
				>{/if}
			<div>
				{#if voiceMessageOnly}<button
						bind:this={voiceCancelElement}
						type="button"
						class="end-call text-destructive"
						aria-label="Cancel voice message"
						title="Cancel voice message"
						onclick={() => {
							onendcall();
							queueMicrotask(() => optionsButton?.focus());
						}}><X width={17} height={17} aria-hidden="true" /></button
					>{:else}<button
						bind:this={callMuteElement}
						type="button"
						aria-pressed={callMuted}
						aria-label={callMuted ? 'Unmute microphone' : 'Mute microphone'}
						title={callMuted ? 'Unmute microphone' : 'Mute microphone'}
						onclick={onmute}
					>
						{#if callMuted}<MicOff width={17} height={17} aria-hidden="true" />{:else}<Mic
								width={17}
								height={17}
								aria-hidden="true"
							/>{/if}
					</button>
					{#if busy || callStatus === 'speaking'}<button
							type="button"
							aria-label="Interrupt Hermes"
							title="Interrupt Hermes and listen"
							onclick={oninterrupt}
							><Square width={13} height={13} fill="currentColor" aria-hidden="true" /></button
						>{/if}
					<button
						type="button"
						class="end-call text-destructive"
						aria-label="End voice call"
						title="End voice call"
						onclick={() => {
							onendcall();
							queueMicrotask(() => optionsButton?.focus());
						}}><PhoneOff width={17} height={17} aria-hidden="true" /></button
					>
				{/if}
			</div>
		</section>{/if}
	<div class="composer-input">
		<textarea
			bind:this={composerElement}
			rows="1"
			value={composer}
			oninput={handleComposerInput}
			{onkeydown}
			{onpaste}
			placeholder={busy
				? 'Type a follow-up and press Enter to queue…'
				: 'Message Hermes… / for commands'}
			aria-label="Message Hermes"
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={commandMatches.length > 0}
			aria-controls={commandMatches.length ? `${instanceId}-command-menu` : undefined}
			aria-activedescendant={commandMatches.length
				? `${instanceId}-command-${Math.max(0, Math.min(commandIndex, commandMatches.length - 1))}`
				: undefined}></textarea>
	</div>
	<div class="composer-toolbar flex min-w-0 items-center gap-2 pt-1">
		<button
			bind:this={optionsButton}
			type="button"
			class="composer-more grid size-11 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
			aria-label="More session options"
			aria-expanded={optionsOpen}
			aria-controls={`${instanceId}-composer-options`}
			title="More session options"
			onclick={() => (optionsOpen = !optionsOpen)}
		>
			<Ellipsis width={20} height={20} aria-hidden="true" />
		</button>
		<div class="composer-activity">
			<ThinkingDialog
				id={`${instanceId}-thinking`}
				items={thinkingTimeline}
				{renderMarkdown}
				{busy}
				bind:open={thinkingOpen}
				onopen={() => (tasksOpen = false)}
			/>
			<CurrentTask {plan} bind:open={tasksOpen} onopen={() => (thinkingOpen = false)} />
		</div>
		<div
			bind:this={optionsMenu}
			id={`${instanceId}-composer-options`}
			class="composer-options-menu"
			class:open={optionsOpen}
			inert={!optionsOpen}
			aria-hidden={!optionsOpen ? 'true' : undefined}
			role="group"
			aria-label="Secondary session options"
		>
			<label
				class="attach-button grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 cursor-pointer place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label={imagePrompts ? 'Attach images and files' : 'Attach files'}
				title={imagePrompts
					? 'Attach documents, audio, video, archives, text, code, or images'
					: 'Attach documents, audio, video, archives, text, or code. Hermes does not support image prompts.'}
			>
				<Paperclip width={20} height={20} aria-hidden="true" />
				<span class="mobile-option-label">Attach files</span>
				<input
					type="file"
					accept={`${imagePrompts ? '.png,.jpg,.jpeg,.gif,.webp,' : ''}.pdf,.doc,.docx,.mp3,.wav,.ogg,.oga,.m4a,.mp4,.m4v,.webm,.mov,.zip,.gz,.tgz,.tar,.7z,.txt,.log,.md,.markdown,.csv,.json,.xml,.css,.ts,.mts,.cts,.tsx,.py,.rs,.go,.java`}
					multiple
					onchange={(event) => {
						optionsOpen = false;
						onimages(event);
					}}
				/>
			</label>
			{#if !callActive}<button
					bind:this={voiceMessageElement}
					type="button"
					class="attach-button voice-start grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 cursor-pointer place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-label="Record voice message"
					title="Record and send voice message"
					onclick={() => {
						optionsOpen = false;
						onvoiceMessage();
					}}
					><Mic width={20} height={20} aria-hidden="true" /><span class="mobile-option-label"
						>Voice message</span
					></button
				>
				<button
					bind:this={voiceStartElement}
					type="button"
					class="attach-button voice-start grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 cursor-pointer place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-label="Start voice call"
					title="Start voice call"
					onclick={() => {
						optionsOpen = false;
						onvoiceCall();
					}}
					><PhoneCall width={20} height={20} aria-hidden="true" /><span class="mobile-option-label"
						>Voice call</span
					></button
				>{/if}
			<span
				class="attach-button grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md border border-border text-muted-foreground"
				aria-label={`Hermes profile: ${runtime.profile}`}
				title={`Hermes profile: ${runtime.profile}`}
			>
				<UserRound width={20} height={20} aria-hidden="true" />
				<span class="mobile-option-label">Profile: {runtime.profile}</span>
			</span>
			<button
				type="button"
				class="attach-button grid h-(--control-height-icon) w-(--control-height-icon) shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Prompt library"
				title="Open prompt library"
				onclick={openPromptLibrary}
			>
				<BookOpenText width={20} height={20} aria-hidden="true" />
				<span class="mobile-option-label">Prompt library</span></button
			>
			{#if runtime.modes}<SessionOptionPicker
					options={runtime.modes.availableModes.map((mode) => ({
						value: mode.id,
						name: mode.name,
						description: `${mode.description ?? 'Choose how Hermes handles file edits.'} Other permission requests still ask.`
					}))}
					value={runtime.modes.currentModeId}
					ariaLabel="Edit approvals"
					kind="mode"
					showLabel={true}
					disabled={runtimeChanging || busy}
					onselect={(value) => onruntime('modeId', value)}
				/>{:else}<button
					type="button"
					class="context-chip session-option-trigger inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-xs text-muted-foreground sm:min-h-8 sm:min-w-8"
					aria-label="Edit approvals"
					title="Edit approvals are unavailable until Hermes starts"
					disabled
				>
					<CircleHelp width={16} height={16} aria-hidden="true" />
					<span class="max-w-24 truncate">Unavailable</span>
				</button>{/if}
			{#if reasoning}<div class="mobile-reasoning-option">
					<SessionOptionPicker
						options={flattenOptions(reasoning.options)}
						value={reasoning.currentValue}
						ariaLabel="Reasoning"
						kind="reasoning"
						showLabel={true}
						disabled={runtimeChanging || busy}
						onselect={(value) => onconfig(reasoning!.id, value)}
					/>
				</div>{/if}
			{#if delivery}<small
					class="mobile-delivery text-xs text-muted-foreground"
					class:warning={delivery.includes('unknown')}
					>{delivery.includes('unknown') ? 'Delivery status unknown' : delivery}</small
				>{/if}
		</div>
		<div
			class="composer-context ml-auto flex min-w-0 items-center gap-1"
			aria-label="Hermes session context"
		>
			{#if reasoning}<div class="desktop-context-option">
					<SessionOptionPicker
						options={flattenOptions(reasoning.options)}
						value={reasoning.currentValue}
						ariaLabel="Reasoning"
						kind="reasoning"
						showLabel={true}
						disabled={runtimeChanging || busy}
						onselect={(value) => onconfig(reasoning!.id, value)}
					/>
				</div>{/if}
			{#if runtime.models}<ModelPicker
					models={runtime.models.availableModels}
					value={runtime.models.currentModelId}
					disabled={runtimeChanging || busy}
					onselect={onmodel}
				/>{/if}
			<SessionOptionPicker
				options={workModeOptions}
				value={workMode}
				ariaLabel="Work mode"
				kind="work"
				showLabel={true}
				disabled={workModeChanging}
				onselect={(value) => onworkmode(value as WorkMode)}
			/>
			{#if showContextUsage && contextPercent() !== null}<span
					class="desktop-context-option context-chip context-usage inline-flex min-h-8 shrink-0 items-center rounded-lg border border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] px-2 text-xs font-bold text-[var(--success)]"
					class:warning={contextPercent()! >= 80}
					title={`${runtime.usage!.used.toLocaleString()} of ${runtime.usage!.size.toLocaleString()} context tokens used`}
					>{contextPercent()}%</span
				>{/if}
		</div>
		{#if delivery}<small
				class="composer-delivery inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
				class:warning={delivery.includes('unknown')}
				title={delivery.includes('unknown')
					? 'Hermes delivery acknowledgement was not confirmed'
					: `Message ${delivery}`}
				><CircleHelp width={14} height={14} aria-hidden="true" />{delivery.includes('unknown')
					? 'Delivery status unknown'
					: delivery}</small
			>{/if}
		{#if pendingEnvelope}<button
				type="button"
				class="retry-message rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
				title="Retry exact message"
				onclick={onretry}
				disabled={busy}>Retry exact message</button
			>{:else if busy}<button
				type="button"
				class="composer-send stop-message grid size-9 place-items-center rounded-lg text-orange-300 hover:bg-accent"
				aria-label={delivery === 'cancelling' ? 'Cancelling' : 'Stop'}
				title={delivery === 'cancelling' ? 'Cancellation requested' : 'Stop current turn'}
				onclick={onstop}
				disabled={stopping || delivery === 'cancelling'}
			>
				<Square width={12} height={12} fill="currentColor" aria-hidden="true" /></button
			>{:else}<button
				type="submit"
				class="composer-send grid size-9 place-items-center rounded-lg hover:bg-accent disabled:opacity-40"
				aria-label="Send"
				title="Send message"
				disabled={!composer.trim() &&
					!images.length &&
					!attachments.length &&
					!reviewContexts.length}
			>
				<Send width={20} height={20} aria-hidden="true" /></button
			>{/if}
	</div>
</form>
<PromptLibraryDialog
	id={`${instanceId}-prompts`}
	bind:dialog={promptLibraryDialog}
	loading={promptLibraryLoading}
	available={promptLibraryAvailable}
	{projectName}
	{workflows}
	bind:name={workflowName}
	bind:prompt={workflowPrompt}
	bind:folder={workflowFolder}
	bind:profile={workflowProfile}
	bind:workMode={workflowWorkMode}
	onsubmit={onworkflow}
	onupdate={onupdateworkflow}
	ondelete={ondeleteworkflow}
	onduplicate={onduplicateworkflow}
	{onfavoritecatalog}
	onload={onloadworkflows}
	oninsert={insertPrompt}
/>
