<script lang="ts">
	import {
		ArrowDown,
		Check,
		ChevronDown,
		ChevronRight,
		Circle,
		CircleDot,
		CircleHelp,
		GripVertical,
		Mic,
		MicOff,
		Paperclip,
		PhoneCall,
		PhoneOff,
		Send,
		Sparkles,
		Square,
		X
	} from 'lucide-svelte';
	import type { WorkspacePlanEntry } from '$lib';
	import type { ImageAttachment, InputAttachment } from '$lib/message-content';
	import { compactModelLabel } from './mobile-navigation';
	import CurrentTask from './CurrentTask.svelte';
	import type { HermesCommand as Command, HermesRuntime as Runtime, QueuedMessage } from './types';
	import type { WorkMode } from '$lib/work-mode';

	type Model = NonNullable<Runtime['models']>['availableModels'][number];

	let {
		composer,
		plan,
		composerElement = $bindable(),
		draggingImages = $bindable(),
		images = $bindable(),
		attachments = $bindable(),
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
		modelMenuOpen = $bindable(),
		modelPopover = $bindable(),
		stopping,
		showScrollToLatest,
		onsubmit,
		ondrop,
		onpaste,
		oninput,
		onkeydown,
		onimages,
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
		onworkmode,
		onscrolllatest,
		matchingCommands,
		currentModel,
		modelCategories,
		contextPercent,
		busy
	}: {
		composer: string;
		plan: WorkspacePlanEntry[];
		composerElement?: HTMLTextAreaElement;
		draggingImages: boolean;
		images: ImageAttachment[];
		attachments: InputAttachment[];
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
		modelMenuOpen: boolean;
		modelPopover?: HTMLElement;
		stopping: boolean;
		showScrollToLatest: boolean;
		busy: boolean;
		onsubmit: (event: SubmitEvent) => void;
		ondrop: (event: DragEvent) => void;
		onpaste: (event: ClipboardEvent) => void;
		oninput: (event: Event) => void;
		onkeydown: (event: KeyboardEvent) => void;
		onimages: (event: Event) => void;
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
		onworkmode: (value: WorkMode) => void;
		onscrolllatest: (behavior: ScrollBehavior) => void;
		matchingCommands: () => Command[];
		currentModel: () => Model | undefined;
		modelCategories: () => Array<{ name: string; models: Model[] }>;
		contextPercent: () => number | null;
	} = $props();
	let modelSearch = $state('');
	function resizeComposer() {
		if (!composerElement) return;
		composerElement.style.height = 'auto';
		composerElement.style.height = `${Math.min(160, Math.max(44, composerElement.scrollHeight))}px`;
		composerElement.style.overflowY = composerElement.scrollHeight > 160 ? 'auto' : 'hidden';
	}
	function handleComposerInput(event: Event) {
		oninput(event);
		resizeComposer();
	}
	function filteredModelCategories() {
		const query = modelSearch.trim().toLowerCase();
		if (!query) return modelCategories();
		return modelCategories()
			.map((category) => ({
				...category,
				models: category.models.filter((model) =>
					`${model.name} ${model.modelId} ${model.description ?? ''}`.toLowerCase().includes(query)
				)
			}))
			.filter((category) => category.models.length);
	}
	$effect(() => {
		composer;
		resizeComposer();
	});
</script>

<svelte:window onresize={resizeComposer} />

<form
	class="composer sticky bottom-0 mx-[clamp(10px,3vw,60px)] mb-5 rounded-2xl border border-border bg-card/95 px-3 py-2.5 shadow-2xl backdrop-blur-xl"
	class:dragging={draggingImages}
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
		onclick={() => onscrolllatest('smooth')}><ArrowDown size={16} aria-hidden="true" /></button
	>
	{#if matchingCommands().length}<div
			class="command-menu absolute right-0 bottom-[calc(100%+8px)] left-0 max-h-[min(360px,45vh)] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-2xl"
			role="listbox"
			aria-label="Hermes commands"
		>
			{#each matchingCommands() as command, index}<button
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
			class="message-queue mb-2 max-h-48 overflow-y-auto rounded-xl border border-border bg-muted/50 p-2.5"
			aria-label="Queued messages"
		>
			<header><strong>Queued messages</strong><span>{queuedMessages.length}</span></header>
			{#each queuedMessages as message}<article>
					<div class="queued-copy flex min-w-0 flex-1 items-center gap-2 text-sm">
						<GripVertical class="queue-handle text-muted-foreground" size={16} aria-hidden="true" />
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
						><X size={14} aria-hidden="true" /></button
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
						><X size={14} aria-hidden="true" /></button
					>
				</article>{/each}
		</div>{/if}
	{#if callActive}<section
			class="voice-call mb-1.5 flex min-w-0 items-center gap-2.5 rounded-xl border border-violet-900 bg-violet-950/40 p-2"
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
						onclick={onendcall}><X size={17} aria-hidden="true" /></button
					>{:else}<button
						bind:this={callMuteElement}
						type="button"
						aria-pressed={callMuted}
						aria-label={callMuted ? 'Unmute microphone' : 'Mute microphone'}
						title={callMuted ? 'Unmute microphone' : 'Mute microphone'}
						onclick={onmute}
					>
						{#if callMuted}<MicOff size={17} aria-hidden="true" />{:else}<Mic
								size={17}
								aria-hidden="true"
							/>{/if}
					</button>
					{#if busy || callStatus === 'speaking'}<button
							type="button"
							aria-label="Interrupt Hermes"
							title="Interrupt Hermes and listen"
							onclick={oninterrupt}
							><Square size={13} fill="currentColor" aria-hidden="true" /></button
						>{/if}
					<button
						type="button"
						class="end-call text-destructive"
						aria-label="End voice call"
						title="End voice call"
						onclick={onendcall}><PhoneOff size={17} aria-hidden="true" /></button
					>
				{/if}
			</div>
		</section>{/if}
	<CurrentTask {plan} />
	<textarea
		bind:this={composerElement}
		value={composer}
		oninput={handleComposerInput}
		{onkeydown}
		{onpaste}
		placeholder={busy
			? 'Type a follow-up and press Enter to queue…'
			: 'Message Hermes… / for commands'}
		aria-label="Message Hermes"></textarea>
	<div class="composer-toolbar flex min-w-0 items-center gap-2 pt-1">
		<label
			class="attach-button grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
			aria-label="Attach images and files"
			title="Attach documents, audio, video, archives, text, code, or images"
		>
			<Paperclip size={20} aria-hidden="true" />
			<input
				type="file"
				accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.mp3,.wav,.ogg,.oga,.m4a,.mp4,.m4v,.webm,.mov,.zip,.gz,.tgz,.tar,.7z,.txt,.log,.md,.markdown,.csv,.json,.xml,.css,.ts,.mts,.cts,.tsx,.py,.rs,.go,.java"
				multiple
				onchange={onimages}
			/>
		</label>
		{#if !callActive}<button
				bind:this={voiceMessageElement}
				type="button"
				class="attach-button voice-start grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Record voice message"
				title="Record and send voice message"
				onclick={onvoiceMessage}><Mic size={20} aria-hidden="true" /></button
			>
			<button
				bind:this={voiceStartElement}
				type="button"
				class="attach-button voice-start grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Start voice call"
				title="Start voice call"
				onclick={onvoiceCall}><PhoneCall size={20} aria-hidden="true" /></button
			>{/if}
		<div
			class="composer-context ml-auto flex min-w-0 items-center gap-1 overflow-x-auto"
			aria-label="Hermes session context"
		>
			<span
				class="context-chip context-profile hidden min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground sm:inline-flex"
				title="Active Hermes profile"
			>
				<Sparkles size={14} aria-hidden="true" /><span>{runtime.profile}</span>
			</span>
			<label
				class="context-chip context-select inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent sm:min-h-8"
				title="Choose HUE work mode"
			>
				<span class="hidden xl:inline">Work mode</span>
				<select
					class="min-h-11 min-w-24 sm:min-h-8"
					aria-label="Work mode"
					value={workMode}
					disabled={workModeChanging}
					onchange={(event) =>
						onworkmode((event.currentTarget as HTMLSelectElement).value as WorkMode)}
				>
					<option value="autonomous">Autonomous</option>
					<option value="live">Live</option>
				</select>
			</label>
			{#if runtime.models}{@const selectedModel = currentModel()}<button
					type="button"
					class="context-chip context-select context-model inline-flex min-h-8 max-w-40 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs hover:bg-accent"
					aria-label="Hermes model"
					aria-haspopup="menu"
					aria-expanded={modelMenuOpen}
					popovertarget="hermes-model-menu"
					title={`${selectedModel?.name ?? runtime.models.currentModelId} · ${runtime.models.currentModelId}`}
					disabled={runtimeChanging || busy}
				>
					<CircleDot size={14} aria-hidden="true" />
					<span
						>{compactModelLabel(
							runtime.models.currentModelId,
							selectedModel?.name ?? runtime.models.currentModelId
						)}</span
					>
					<ChevronDown size={13} aria-hidden="true" />
				</button>
				<div
					bind:this={modelPopover}
					id="hermes-model-menu"
					class="model-menu max-h-[min(520px,calc(100dvh-24px))] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-border bg-card p-2 text-foreground shadow-2xl"
					popover="auto"
					role="menu"
					aria-label="Choose Hermes model"
					ontoggle={(event) =>
						(modelMenuOpen = (event.currentTarget as HTMLElement).matches(':popover-open'))}
				>
					<header>
						<div>
							<strong>Choose model</strong><small class="block text-muted-foreground"
								>Current: {selectedModel?.name ?? runtime.models.currentModelId}</small
							>
						</div>
						<button
							type="button"
							class="model-menu-close"
							aria-label="Close model picker"
							title="Close model picker"
							onclick={() => modelPopover?.hidePopover()}><X size={18} aria-hidden="true" /></button
						>
					</header>
					<label class="model-search"
						><span class="sr-only">Search models</span><input
							bind:value={modelSearch}
							type="search"
							aria-label="Search models"
							placeholder="Search models"
						/></label
					>
					{#each filteredModelCategories() as category}
						<details
							open={Boolean(modelSearch) ||
								category.models.some((model) => model.modelId === runtime.models?.currentModelId)}
						>
							<summary>
								<span>{category.name}</span>
								<small
									>{category.models.length}
									{category.models.length === 1 ? 'model' : 'models'}</small
								>
								<ChevronRight size={14} aria-hidden="true" />
							</summary>
							<div class="model-options pb-1.5">
								{#each category.models as model}<button
										type="button"
										role="menuitemradio"
										aria-checked={model.modelId === runtime.models?.currentModelId}
										title={`Use ${model.name} · ${model.modelId}`}
										onclick={() => onmodel(model.modelId)}
									>
										<span class="model-check pt-0.5 text-violet-300"
											>{#if model.modelId === runtime.models?.currentModelId}<Check
													size={15}
													aria-hidden="true"
												/>{/if}</span
										>
										<span
											><strong>{model.name}</strong><small
												>{model.modelId}{model.description ? ` · ${model.description}` : ''}</small
											></span
										>
									</button>{/each}
							</div>
						</details>
					{/each}
					{#if filteredModelCategories().length === 0}<p class="p-3 text-sm text-muted-foreground">
							No matching models.
						</p>{/if}
				</div>{/if}
			{#if runtime.modes}<label
					class="context-chip context-select context-mode inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-emerald-300 hover:bg-accent"
					title="Hermes edit mode"
				>
					<Circle size={14} aria-hidden="true" />
					<select
						aria-label="Hermes mode"
						value={runtime.modes.currentModeId}
						disabled={runtimeChanging || busy}
						onchange={(event) =>
							onruntime('modeId', (event.currentTarget as HTMLSelectElement).value)}
					>
						{#each runtime.modes.availableModes as mode}<option value={mode.id}>{mode.name}</option
							>{/each}
					</select>
				</label>{/if}
			{#if contextPercent() !== null}<span
					class="context-chip context-usage inline-flex min-h-8 shrink-0 items-center rounded-lg border border-emerald-900 bg-emerald-950 px-2 text-xs font-bold text-emerald-300"
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
				><CircleHelp size={14} aria-hidden="true" />{delivery.includes('unknown')
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
				aria-label="Stop"
				title="Stop current turn"
				onclick={onstop}
				disabled={stopping}
			>
				<Square size={12} fill="currentColor" aria-hidden="true" /></button
			>{:else}<button
				type="submit"
				class="composer-send grid size-9 place-items-center rounded-lg hover:bg-accent disabled:opacity-40"
				aria-label="Send"
				title="Send message"
				disabled={!composer.trim() && !images.length && !attachments.length}
			>
				<Send size={20} aria-hidden="true" /></button
			>{/if}
	</div>
</form>
