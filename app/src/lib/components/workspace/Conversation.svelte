<script lang="ts">
	import Copy from '~icons/lucide/copy';
	import Download from '~icons/lucide/download';
	import ExternalLink from '~icons/lucide/external-link';
	import FolderOpen from '~icons/lucide/folder-open';
	import GitFork from '~icons/lucide/git-fork';
	import Pencil from '~icons/lucide/pencil';
	import Quote from '~icons/lucide/quote';
	import type {
		ImageAttachment,
		InputAttachment,
		ReviewContext,
		ReviewContextSeed
	} from '$lib/message-content';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { permissionDetails } from './permission-consequence';
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
	function handleTranscriptClick(event: MouseEvent) {
		const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy-code]');
		if (!button) return;
		const code = button.parentElement?.querySelector('code')?.textContent ?? '';
		oncopycode(code);
	}
	function copyDelegation(node: HTMLElement) {
		node.addEventListener('click', handleTranscriptClick);
		return { destroy: () => node.removeEventListener('click', handleTranscriptClick) };
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
	aria-live="polite"
	tabindex="0"
	bind:this={element}
	use:follow
	use:copyDelegation
>
	<div class="transcript-content min-h-full">
		{#if messageNotice}<span class="copy-notice" role="status">{messageNotice}</span>{/if}
		{#each transcriptTimeline as item, index (item.kind + ':' + item.sequence)}
			{#if item.kind === 'message'}
				{@const message = item}
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
						{#if message.role === 'assistant' && mediaOutputs(message.text).length}<div
								class="mb-2 grid gap-1.5"
								aria-label="Generated outputs"
							>
								{#each mediaOutputs(message.text) as path}<article
										class="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
									>
										<div class="min-w-0">
											<strong class="block truncate">{path.split('/').at(-1)}</strong><small
												title={`Hermes MEDIA: ${path}`}>Hermes MEDIA output · {path}</small
											>
										</div>
										<div class="flex">
											<a
												class="grid min-h-11 min-w-11 place-items-center"
												href={`${mediaPath}?path=${encodeURIComponent(path)}`}
												target="_blank"
												rel="noreferrer"
												aria-label={`Preview ${path}`}
												title={`Preview ${path}`}
												><ExternalLink width={16} height={16} aria-hidden="true" /></a
											><a
												class="grid min-h-11 min-w-11 place-items-center"
												href={`${mediaPath}?path=${encodeURIComponent(path)}&download=true`}
												download
												aria-label={`Download ${path}`}
												title={`Download ${path}`}
												><Download width={16} height={16} aria-hidden="true" /></a
											><button
												type="button"
												class="grid min-h-11 min-w-11 place-items-center"
												onclick={() => onmedia(path, 'open')}
												aria-label={`Open ${path}`}
												title={`Open ${path}`}
												><ExternalLink width={16} height={16} aria-hidden="true" /></button
											><button
												type="button"
												class="grid min-h-11 min-w-11 place-items-center"
												onclick={() => onmedia(path, 'reveal')}
												aria-label={`Reveal ${path}`}
												title={`Reveal ${path}`}
												><FolderOpen width={16} height={16} aria-hidden="true" /></button
											>
										</div>
									</article>{/each}
							</div>{/if}
						{#if message.role === 'assistant'}
							<div
								class="message markdown rounded-lg rounded-tl-sm border border-border bg-card px-3 py-2.5 leading-relaxed"
							>
								{#if message.images?.length}<div
										class="message-images mb-2 grid grid-cols-2 gap-1.5"
									>
										{#each message.images as image}<img
												src={`data:${image.mimeType};base64,${image.data}`}
												alt={image.name}
											/>{/each}
									</div>{/if}
								{@html renderMarkdown(
									message.text
								)}{#if index === transcriptTimeline.length - 1 && busy}<span
										class="cursor animate-pulse text-primary">▋</span
									>{/if}
							</div>
						{:else}
							<div
								class="message user-message rounded-2xl rounded-tr-md border border-border bg-accent/60 px-4 py-3 leading-relaxed"
							>
								{#if message.images?.length}<div
										class="message-images mb-2 grid grid-cols-2 gap-1.5"
									>
										{#each message.images as image}<img
												src={`data:${image.mimeType};base64,${image.data}`}
												alt={image.name}
											/>{/each}
									</div>{/if}
								{#if message.text}<p>{message.text}</p>{/if}
							</div>
						{/if}
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
					class="permission-card activity-card mx-auto mb-4 max-w-[774px] rounded-xl border border-amber-500/50 bg-card p-3"
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
