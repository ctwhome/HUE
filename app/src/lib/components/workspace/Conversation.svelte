<script module lang="ts">
	let mermaidLoader: Promise<(typeof import('mermaid'))['default']> | undefined;
	let mermaidId = 0;

	async function renderMermaid(source: string) {
		const mermaid = await (mermaidLoader ??= import('mermaid').then(({ default: renderer }) => {
			renderer.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				theme: 'default',
				flowchart: { htmlLabels: false }
			});
			return renderer;
		}));
		return (await mermaid.render(`hue-mermaid-${++mermaidId}`, source)).svg;
	}
</script>

<script lang="ts">
	import { mount, unmount } from 'svelte';
	import Copy from '~icons/lucide/copy';
	import ChevronUp from '~icons/lucide/chevron-up';
	import Download from '~icons/lucide/download';
	import GitFork from '~icons/lucide/git-fork';
	import Pencil from '~icons/lucide/pencil';
	import Quote from '~icons/lucide/quote';
	import RotateCcw from '~icons/lucide/rotate-ccw';
	import X from '~icons/lucide/x';
	import ZoomIn from '~icons/lucide/zoom-in';
	import ZoomOut from '~icons/lucide/zoom-out';
	import type {
		ImageAttachment,
		InputAttachment,
		ReviewContext,
		ReviewContextSeed
	} from '$lib/message-content';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { artifactKind, artifactName, artifactUrl } from '$lib/artifact';
	import ArtifactTextPreview from './ArtifactTextPreview.svelte';
	import CsvPreview from './CsvPreview.svelte';
	import GeneratedOutputs from './GeneratedOutputs.svelte';
	import MarkdownControls from './MarkdownControls.svelte';
	import { permissionDetails } from './permission-consequence';
	import { activeTurnStatus, skillsUsed } from './thinking-state';
	import {
		selectTranscriptTimeline,
		type WorkspaceActivity,
		type WorkspaceTimelineItem
	} from '$lib';

	type Message = {
		role: 'user' | 'assistant';
		text: string;
		images?: ImageAttachment[];
		attachments?: InputAttachment[];
		reviewContexts?: ReviewContext[];
		createdAt?: string;
	};

	let {
		timeline,
		messageNotice,
		agentLabel,
		sessionLabel,
		busy,
		renderMarkdown,
		onedit,
		oncopy,
		oncopycode,
		oncopytable,
		oninteraction,
		mediaPath,
		onmedia,
		onretrylast,
		onquote,
		element = $bindable(),
		follow
	}: {
		timeline: WorkspaceTimelineItem[];
		messageNotice: string;
		agentLabel: string;
		sessionLabel: string;
		busy: boolean;
		renderMarkdown: (text: string) => string;
		onedit: (message: Message) => void;
		oncopy: (message: Message) => void;
		oncopycode: (code: string) => void;
		oncopytable: (table: string) => void;
		oninteraction: (
			id: string,
			response:
				| { kind: 'permission'; optionId: string }
				| { kind: 'clarify'; action: 'accept'; content: Record<string, string | string[]> }
				| { kind: 'clarify'; action: 'cancel' }
		) => void;
		mediaPath: string;
		onmedia: (path: string, action: 'open' | 'reveal') => void;
		onretrylast: () => void;
		onquote: (context: ReviewContextSeed) => void;
		element?: HTMLElement;
		follow: (node: HTMLElement) => { destroy: () => void };
	} = $props();

	function mediaOutputs(text: string): string[] {
		return [
			...new Set(
				text.split(/\r?\n/).flatMap((line) => line.match(/^MEDIA:\s*(.+?)\s*$/)?.[1] ?? [])
			)
		];
	}
	const mediaKind = artifactKind;
	const mediaName = artifactName;
	const mediaUrl = (path: string) => artifactUrl(mediaPath, path);
	let showcaseDialog: HTMLDialogElement;
	let showcasePath = $state('');
	let zoom = $state(1);
	function showMedia(path: string) {
		showcasePath = path;
		zoom = 1;
		showcaseDialog.showModal();
	}
	function resetShowcase() {
		showcasePath = '';
		zoom = 1;
	}

	const validTimestamp = (value?: string): value is string =>
		!!value && !Number.isNaN(Date.parse(value));
	const timestamp = (value: string) =>
		new Date(value).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		});
	const timestampTitle = (value: string) =>
		new Date(value).toLocaleString([], { dateStyle: 'full', timeStyle: 'long' });
	let transcriptTimeline = $derived(selectTranscriptTimeline(timeline));
	let turnStatus = $derived(activeTurnStatus(timeline, busy));
	let expandedUserMessages = $state<string[]>([]);
	let truncatedUserMessages = $state<string[]>([]);
	const userMessageKey = (message: Message & { messageId?: string; sequence: number }) =>
		message.messageId ?? `${message.sequence}:${message.text}`;
	function setUserMessageTruncated(key: string, truncated: boolean) {
		if (truncated === truncatedUserMessages.includes(key)) return;
		truncatedUserMessages = truncated
			? [...truncatedUserMessages, key]
			: truncatedUserMessages.filter((candidate) => candidate !== key);
	}
	function measureUserMessage(node: HTMLElement, key: string) {
		let currentKey = key;
		let frame = 0;
		const measure = () => {
			if (node.classList.contains('collapsed'))
				setUserMessageTruncated(currentKey, node.scrollHeight > node.clientHeight + 1);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		const paragraph = node.querySelector('p');
		if (paragraph) observer.observe(paragraph);
		frame = requestAnimationFrame(measure);
		return {
			update(nextKey: string) {
				if (nextKey === currentKey) return;
				setUserMessageTruncated(currentKey, false);
				currentKey = nextKey;
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(measure);
			},
			destroy() {
				cancelAnimationFrame(frame);
				observer.disconnect();
				setUserMessageTruncated(currentKey, false);
			}
		};
	}
	function expandUserMessage(event: MouseEvent | KeyboardEvent, key: string, collapsible: boolean) {
		if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
		if (getSelection()?.toString()) return;
		if (!collapsible) return;
		if (event instanceof KeyboardEvent) event.preventDefault();
		if (!expandedUserMessages.includes(key)) expandedUserMessages = [...expandedUserMessages, key];
	}
	function collapseUserMessage(event: MouseEvent, key: string) {
		event.stopPropagation();
		expandedUserMessages = expandedUserMessages.filter((candidate) => candidate !== key);
	}
	function renderChatMarkdown(text: string) {
		return renderMarkdown(text)
			.replaceAll(
				'<table>',
				'<div class="table-block table-wrap"><div class="table-toolbar"></div><div class="table-scroll"><table>'
			)
			.replaceAll('</table>', '</table></div></div>');
	}
	function markdownInteractions(node: HTMLElement) {
		const diagrams = new Map<HTMLImageElement, string>();
		const controls = new Map<HTMLElement, ReturnType<typeof mount>>();
		const mountControls = () => {
			for (const [toolbar, component] of controls) {
				if (toolbar.isConnected) continue;
				void unmount(component);
				controls.delete(toolbar);
			}
			for (const toolbar of node.querySelectorAll<HTMLElement>(
				'.table-toolbar:not([data-controls-mounted])'
			)) {
				const block = toolbar.closest<HTMLElement>('.table-block')!;
				toolbar.dataset.controlsMounted = 'true';
				controls.set(
					toolbar,
					mount(MarkdownControls, {
						target: toolbar,
						props: {
							kind: 'table',
							oncopy: () => {
								const rows = Array.from(block.querySelectorAll('tr'), (row) =>
									Array.from(
										row.querySelectorAll('th, td'),
										(cell) => cell.textContent?.trim() ?? ''
									).join('\t')
								);
								oncopytable(rows.join('\n'));
							},
							ontogglewrap: (wrapped: boolean) => block.classList.toggle('table-wrap', wrapped)
						}
					})
				);
			}
			for (const toolbar of node.querySelectorAll<HTMLElement>(
				'.code-toolbar:not([data-controls-mounted])'
			)) {
				const block = toolbar.closest<HTMLElement>('.code-block')!;
				const code = block.querySelector('code')!;
				const mermaid = code.classList.contains('language-mermaid');
				if (mermaid && !['rendered', 'source'].includes(code.dataset.mermaidState ?? '')) continue;
				toolbar.dataset.controlsMounted = 'true';
				controls.set(
					toolbar,
					mount(MarkdownControls, {
						target: toolbar,
						props: {
							kind: mermaid && code.dataset.mermaidState === 'rendered' ? 'mermaid' : 'code',
							oncopy: () => oncopycode(code.textContent ?? ''),
							ontogglewrap: (wrapped: boolean) => block.classList.toggle('code-wrap', wrapped),
							ontogglesource: (shown: boolean) =>
								block.classList.toggle('show-mermaid-source', shown),
							ondownload: () => {
								const image = block.querySelector<HTMLImageElement>('.mermaid-diagram');
								if (!image) return;
								const link = document.createElement('a');
								link.href = image.src;
								link.download = 'mermaid-diagram.svg';
								link.click();
							}
						}
					})
				);
			}
		};
		const enhanceMermaid = () => {
			mountControls();
			for (const [image, url] of diagrams) {
				if (image.isConnected) continue;
				URL.revokeObjectURL(url);
				diagrams.delete(image);
			}
			for (const code of node.querySelectorAll<HTMLElement>(
				'code.language-mermaid:not([data-mermaid-state])'
			)) {
				const source = code.textContent?.trim() ?? '';
				code.dataset.mermaidState = 'rendering';
				if (!source || source.length > 50_000) {
					code.dataset.mermaidState = 'source';
					mountControls();
					continue;
				}
				void renderMermaid(source)
					.then((svg) => {
						const block = code.closest('.code-block');
						if (!block?.isConnected) return;
						const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
						const image = new Image();
						image.className = 'mermaid-diagram';
						image.alt = 'Mermaid diagram';
						image.src = url;
						block.querySelector('pre')?.before(image);
						block.classList.add('has-mermaid-diagram');
						code.dataset.mermaidState = 'rendered';
						diagrams.set(image, url);
						mountControls();
					})
					.catch(() => {
						code.dataset.mermaidState = 'source';
						mountControls();
					});
			}
		};
		const observer = new MutationObserver(enhanceMermaid);
		observer.observe(node, { childList: true, subtree: true });
		enhanceMermaid();
		return {
			destroy: () => {
				observer.disconnect();
				for (const url of diagrams.values()) URL.revokeObjectURL(url);
				for (const component of controls.values()) void unmount(component);
			}
		};
	}
	function submitClarify(event: SubmitEvent, item: WorkspaceActivity) {
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement);
		const content = Object.fromEntries(
			(item.fields ?? []).flatMap((field) => {
				const values = data.getAll(field.name).map(String);
				if (!values.length) return [];
				return [[field.name, field.control === 'multi' ? values : values[0]]];
			})
		) as Record<string, string | string[]>;
		oninteraction(item.id, { kind: 'clarify', action: 'accept', content });
	}
	function quoteSelection(event: MouseEvent) {
		const article = (event.currentTarget as HTMLElement).closest('article');
		const selection = getSelection();
		const content = selection?.toString().trim() ?? '';
		if (
			!article ||
			!content ||
			!selection?.rangeCount ||
			!article.contains(selection.getRangeAt(0).commonAncestorContainer)
		)
			return;
		onquote({ source: 'assistant', label: `${agentLabel} response`, content });
		selection.removeAllRanges();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
	class="transcript min-h-0 flex-1 overflow-auto overflow-x-hidden px-[clamp(12px,2.5vw,40px)] pt-8"
	class:empty={transcriptTimeline.length === 0}
	aria-label="Conversation"
	tabindex="0"
	bind:this={element}
	use:follow
	use:markdownInteractions
>
	<div class="transcript-content min-h-full">
		{#if messageNotice}<span class="copy-notice" role="status">{messageNotice}</span>{/if}
		{#each transcriptTimeline as item, index (item.kind + ':' + item.sequence)}
			{#if item.kind === 'message'}
				{@const message = item}
				{@const messageKey = userMessageKey(message)}
				{@const messageSkills = skillsUsed(timeline, message.messageId)}
				{@const messageCollapsible =
					truncatedUserMessages.includes(messageKey) || Boolean(message.images?.length)}
				<article
					data-timeline-sequence={item.sequence}
					data-message-id={message.messageId}
					tabindex="-1"
					class:assistant={message.role === 'assistant'}
					class:user={message.role === 'user'}
				>
					<div class="message-identity flex items-center gap-2 text-xs text-muted-foreground">
						<span
							class="avatar grid size-6 shrink-0 place-items-center rounded-md bg-muted font-bold text-primary"
							>{message.role === 'assistant' ? 'H' : 'You'}</span
						><strong>{message.role === 'assistant' ? agentLabel : 'You'}</strong>
					</div>
					<div class="message-stack grid min-w-0">
						{#if message.role === 'user' && message.reviewContexts?.length}<section
								class="mb-2 grid gap-1.5"
								aria-label="Sent review contexts"
							>
								{#each message.reviewContexts as context}<article
										class="min-w-0 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm"
									>
										<strong class="block truncate text-xs">{context.label}</strong>
										<details class="mt-1 min-w-0">
											<summary>Captured source</summary>
											<pre
												class="mt-1 max-h-48 overflow-auto text-xs break-words whitespace-pre-wrap">{context.content}</pre>
										</details>
										{#if context.comment}<p class="mt-1 break-words">
												<strong>Comment:</strong>
												{context.comment}
											</p>{/if}
									</article>{/each}
							</section>{/if}
						{#if message.attachments?.length}<div
								class="mb-2 grid gap-1.5"
								aria-label="Message attachments"
							>
								{#each message.attachments as attachment}<article
										class="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
									>
										<span
											class="min-w-0 flex-1 truncate"
											title={`${attachment.name} · ${attachment.mimeType}`}>{attachment.name}</span
										>
										<small
											>{Math.max(1, Math.ceil(attachment.size / 1024))} KB · {attachment.data
												? 'User attachment'
												: 'Reattach required'}</small
										>
										{#if attachment.data}<a
												class="grid min-h-11 min-w-11 place-items-center"
												href={`data:${attachment.mimeType};base64,${attachment.data}`}
												download={attachment.name}
												aria-label={`Download ${attachment.name}`}
												title={`Download ${attachment.name}`}>Download</a
											>{/if}
									</article>{/each}
							</div>{/if}
						{#if message.role === 'assistant' && mediaOutputs(message.text).length}<GeneratedOutputs
								paths={mediaOutputs(message.text)}
								{mediaPath}
								onshow={showMedia}
								{onmedia}
							/>{/if}
						{#if message.role === 'assistant'}
							<div class="message markdown leading-relaxed">
								{#if message.images?.length}<div
										class="message-images mb-2 grid grid-cols-2 gap-1.5"
									>
										{#each message.images as image}<img
												src={`data:${image.mimeType};base64,${image.data}`}
												alt={image.name}
											/>{/each}
									</div>{/if}
								{@html renderChatMarkdown(
									message.text
								)}{#if index === transcriptTimeline.length - 1 && busy}<span
										class="cursor animate-pulse text-primary">▋</span
									>{/if}
							</div>
						{:else}
							<div
								class="message user-message relative rounded-2xl rounded-br-md border bg-accent/60"
								class:expanded={expandedUserMessages.includes(messageKey)}
							>
								{#if expandedUserMessages.includes(messageKey)}<button
										type="button"
										class="collapse-user-message"
										aria-label="Collapse message"
										title="Collapse message"
										onclick={(event) => collapseUserMessage(event, messageKey)}
										><ChevronUp width={14} height={14} aria-hidden="true" /></button
									>{/if}
								<div
									class="user-message-body"
									class:collapsed={!expandedUserMessages.includes(messageKey)}
									class:has-images={Boolean(message.images?.length)}
									role={messageCollapsible && !expandedUserMessages.includes(messageKey)
										? 'button'
										: undefined}
									tabindex={messageCollapsible && !expandedUserMessages.includes(messageKey)
										? 0
										: undefined}
									aria-expanded={messageCollapsible
										? expandedUserMessages.includes(messageKey)
										: undefined}
									aria-label={messageCollapsible && !expandedUserMessages.includes(messageKey)
										? 'Expand full message'
										: undefined}
									onclick={(event) => expandUserMessage(event, messageKey, messageCollapsible)}
									onkeydown={(event) => expandUserMessage(event, messageKey, messageCollapsible)}
								>
									{#if message.images?.length}<div
											class="message-images mb-2 grid grid-cols-2 gap-1.5"
										>
											{#each message.images as image}<img
													src={`data:${image.mimeType};base64,${image.data}`}
													alt={image.name}
												/>{/each}
										</div>{/if}
									{#if message.text}<div
											class="user-message-content"
											class:collapsed={!expandedUserMessages.includes(messageKey)}
											use:measureUserMessage={messageKey}
										>
											<p>{message.text}</p>
										</div>{/if}
								</div>
							</div>
						{/if}
						{#if message.role === 'assistant' && messageSkills.length}<div
								class="message-skills"
								aria-label="Skills used"
							>
								{#each messageSkills as skill}<span>Skill used: {skill}</span>{/each}
							</div>{/if}
						<div class="message-actions mt-1 flex gap-0.5">
							{#if message.role === 'user'}<button
									type="button"
									aria-label="Edit and resend message"
									title="Edit and resend message"
									onclick={() => onedit(message)}
									><Pencil width={14} height={14} aria-hidden="true" /></button
								>{/if}
							{#if message.role === 'assistant'}<button
									type="button"
									class="max-[700px]:min-h-11 max-[700px]:min-w-11"
									aria-label="Add selected text to prompt"
									title="Select part of this response, then add it to the next prompt"
									onclick={quoteSelection}
									><Quote width={14} height={14} aria-hidden="true" /></button
								>{/if}
							<button
								type="button"
								aria-label="Copy message"
								title="Copy message"
								onclick={() => oncopy(message)}
								><Copy width={14} height={14} aria-hidden="true" /></button
							>
							<button
								type="button"
								aria-label="Fork from this message unavailable"
								title="Hermes ACP can duplicate a full Session but cannot fork from a selected message"
								disabled><GitFork width={14} height={14} aria-hidden="true" /></button
							>
							{#if message.role === 'assistant' && index === transcriptTimeline.length - 1}<button
									type="button"
									aria-label="Retry last response"
									title="Retry last response by resending previous user message"
									disabled={busy}
									onclick={onretrylast}>Retry</button
								>{/if}
							{#if validTimestamp(message.createdAt)}<time
									class="ml-auto text-xs text-muted-foreground"
									datetime={message.createdAt}
									title={timestampTitle(message.createdAt)}
									aria-label={timestampTitle(message.createdAt)}
									>{timestamp(message.createdAt)}</time
								>{/if}
						</div>
					</div>
				</article>
			{:else if item.kind === 'permission'}{@const permission = permissionDetails(
					item.toolCall ?? {}
				)}
				<section
					data-timeline-sequence={item.sequence}
					data-message-id={item.messageId}
					tabindex="-1"
					class="permission-card activity-card mx-auto mb-4 max-w-[774px] rounded-xl border border-[var(--warning)] bg-card p-3"
					role="group"
					aria-label={`Permission required: ${item.toolCall?.title ?? 'Hermes tool'}`}
				>
					<header>
						<strong>Permission required</strong>{#if validTimestamp(item.createdAt)}<time
								datetime={item.createdAt}
								title={timestampTitle(item.createdAt)}
								aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
							>{/if}
					</header>
					<h3>{permission.title}</h3>
					<dl class="permission-context">
						<div>
							<dt>Action</dt>
							<dd>{permission.action}</dd>
						</div>
						<div>
							<dt>Session</dt>
							<dd>{sessionLabel}</dd>
						</div>
						{#each permission.preview as row}<div>
								<dt>{row.label}</dt>
								<dd><code>{row.value}</code></dd>
							</div>{/each}
					</dl>
					<p class="permission-consequence">{permission.consequence}</p>
					{#if item.status === 'pending'}<div class="interaction-actions flex flex-wrap gap-2">
							{#each item.options ?? [] as option}<button
									type="button"
									onclick={() =>
										oninteraction(item.id, { kind: 'permission', optionId: option.optionId })}
									>{option.name}</button
								>{/each}
						</div>{:else}<p class="activity-status" role="status">{item.status}</p>{/if}
				</section>
			{:else if item.kind === 'clarify'}<form
					data-timeline-sequence={item.sequence}
					data-message-id={item.messageId}
					tabindex="-1"
					class="clarify-card activity-card mx-auto mb-4 grid max-w-[774px] gap-3 rounded-xl border border-sky-500/50 bg-card p-3"
					role="group"
					aria-label={`Clarify: ${item.message ?? 'Hermes question'}`}
					onsubmit={(event) => submitClarify(event, item)}
				>
					<header>
						<strong>{item.message ?? 'Hermes needs input'}</strong
						>{#if validTimestamp(item.createdAt)}<time
								datetime={item.createdAt}
								title={timestampTitle(item.createdAt)}
								aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
							>{/if}
					</header>
					{#if item.status === 'pending'}{#each item.fields ?? [] as field}<fieldset>
								<legend>{field.label}</legend>{#if field.control === 'text'}<input
										name={field.name}
										aria-label={field.label}
										required={field.required}
										maxlength="10000"
									/>{:else}{#each field.options ?? [] as option}<label
											><input
												type={field.control === 'multi' ? 'checkbox' : 'radio'}
												name={field.name}
												value={option.value}
												required={field.required && field.control === 'single'}
											/>
											{option.label}</label
										>{/each}{/if}
							</fieldset>{/each}
						<div class="interaction-actions flex flex-wrap gap-2">
							<button type="submit">Submit answer</button><button
								type="button"
								onclick={() => oninteraction(item.id, { kind: 'clarify', action: 'cancel' })}
								>Cancel</button
							>
						</div>{:else}<p class="activity-status" role="status">{item.status}</p>{/if}
				</form>
			{/if}
		{/each}
		{#if turnStatus}<div class="turn-activity" role="status" aria-live="polite">
				<span class="turn-activity-matrix" aria-hidden="true">
					{#each [2, 1, 2, 1, 0, 1, 2, 1, 2] as ring}<i style={`--activity-ring: ${ring}`}
						></i>{/each}
				</span>
				<span>{turnStatus}</span>
			</div>{/if}
		{#if transcriptTimeline.length === 0}<div
				class="welcome mx-auto max-w-2xl text-center text-muted-foreground"
			>
				<BrandMark class="welcome-mark mx-auto mb-[18px] size-14" />
				<h2>Start this Hermes Session</h2>
				<p>Your complete message is saved before HUE sends it.</p>
			</div>{/if}
		{#if transcriptTimeline.length}<div
				class="transcript-spacer h-[max(48px,10vh)]"
				aria-hidden="true"
			></div>{/if}
	</div>
</section>

<dialog
	bind:this={showcaseDialog}
	class="m-auto h-[min(92dvh,900px)] w-[min(96vw,1200px)] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/80"
	aria-label={showcasePath ? mediaName(showcasePath) : 'File preview'}
	onclose={resetShowcase}
	onclick={(event) => event.target === showcaseDialog && showcaseDialog.close()}
>
	{#if showcasePath}<div class="grid h-full grid-rows-[auto_minmax(0,1fr)]">
			<header class="flex min-h-14 items-center gap-2 border-b border-border px-3">
				<strong class="min-w-0 flex-1 truncate">{mediaName(showcasePath)}</strong>
				{#if mediaKind(showcasePath) === 'image'}<button
						type="button"
						class="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-accent"
						disabled={zoom <= 0.5}
						onclick={() => (zoom = Math.max(0.5, zoom - 0.25))}
						aria-label="Zoom out"
						title="Zoom out"><ZoomOut width={18} height={18} aria-hidden="true" /></button
					><button
						type="button"
						class="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-accent"
						onclick={() => (zoom = 1)}
						aria-label="Reset zoom"
						title={`${Math.round(zoom * 100)}%`}
						><RotateCcw width={18} height={18} aria-hidden="true" /></button
					><button
						type="button"
						class="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-accent"
						disabled={zoom >= 3}
						onclick={() => (zoom = Math.min(3, zoom + 0.25))}
						aria-label="Zoom in"
						title="Zoom in"><ZoomIn width={18} height={18} aria-hidden="true" /></button
					>{/if}<a
					class="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-accent"
					href={`${mediaUrl(showcasePath)}&download=true`}
					download
					aria-label={`Download ${showcasePath}`}
					title={`Download ${showcasePath}`}
					><Download width={18} height={18} aria-hidden="true" /></a
				><button
					type="button"
					class="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-accent"
					onclick={() => showcaseDialog.close()}
					aria-label="Close preview"
					title="Close preview"><X width={20} height={20} aria-hidden="true" /></button
				>
			</header>
			<div class="min-h-0 overflow-auto bg-black/90 p-2 sm:p-4">
				{#if mediaKind(showcasePath) === 'image'}<div
						class="grid min-h-full min-w-full place-items-center"
					>
						<img
							class="block h-auto max-w-none object-contain transition-[width]"
							style={`width: ${zoom * 100}%`}
							src={mediaUrl(showcasePath)}
							alt={`Preview of ${mediaName(showcasePath)}`}
						/>
					</div>{:else if mediaKind(showcasePath) === 'video'}<video
						class="size-full object-contain"
						controls
						autoplay
						src={mediaUrl(showcasePath)}><track kind="captions" /></video
					>{:else if mediaKind(showcasePath) === 'audio'}<div
						class="grid h-full place-items-center"
					>
						<audio class="w-full max-w-2xl" controls autoplay src={mediaUrl(showcasePath)}
							><track kind="captions" /></audio
						>
					</div>{:else if mediaKind(showcasePath) === 'csv'}<CsvPreview
						src={mediaUrl(showcasePath)}
						name={mediaName(showcasePath)}
						full
					/>{:else if mediaKind(showcasePath) === 'text'}<ArtifactTextPreview
						src={mediaUrl(showcasePath)}
						name={mediaName(showcasePath)}
						full
					/>{:else}<iframe
						class="size-full border-0 bg-white"
						title={`Preview of ${mediaName(showcasePath)}`}
						src={mediaUrl(showcasePath)}
						sandbox={mediaKind(showcasePath) === 'html' ? '' : undefined}
					></iframe>{/if}
			</div>
		</div>{/if}
</dialog>
