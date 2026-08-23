<script lang="ts">
	import {
		ChevronRight,
		Copy,
		Download,
		ExternalLink,
		FolderOpen,
		GitFork,
		Pencil
	} from 'lucide-svelte';
	import type { ImageAttachment, InputAttachment } from '$lib/message-content';
	import type { WorkspaceActivity, WorkspacePlanEntry, WorkspaceTimelineItem } from '$lib';
	import LiquidThinkingOrb from './LiquidThinkingOrb.svelte';
	import { activeThought } from './thinking-state';

	type Message = {
		role: 'user' | 'assistant';
		text: string;
		images?: ImageAttachment[];
		attachments?: InputAttachment[];
		createdAt?: string;
	};

	let {
		timeline,
		messageNotice,
		busy,
		renderMarkdown,
		onedit,
		oncopy,
		oncopycode,
		oninteraction,
		mediaPath,
		onmedia,
		onretrylast,
		element = $bindable(),
		follow
	}: {
		timeline: WorkspaceTimelineItem[];
		messageNotice: string;
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

	const serialized = (value: unknown) =>
		typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	const progress = (plan: WorkspacePlanEntry[]) =>
		plan.filter(({ status }) => status === 'completed').length;
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
	let currentThought = $derived(activeThought(timeline, busy));
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
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
	class="transcript min-h-0 flex-1 overflow-auto overflow-x-hidden px-[clamp(20px,7vw,110px)] pt-8"
	aria-label="Conversation"
	aria-live="polite"
	tabindex="0"
	bind:this={element}
	use:follow
	use:copyDelegation
>
	<div class="transcript-content min-h-full">
		{#if messageNotice}<span class="copy-notice" role="status">{messageNotice}</span>{/if}
		{#each timeline as item, index (item.kind + ':' + item.sequence)}
			{#if item.kind === 'message'}
				{@const message = item}
				<article
					data-timeline-sequence={item.sequence}
					class:assistant={message.role === 'assistant'}
					class:user={message.role === 'user'}
				>
					<div
						class="avatar grid h-8 min-w-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-bold text-violet-300"
					>
						{message.role === 'assistant' ? 'H' : 'You'}
					</div>
					<div class="message-stack grid min-w-0">
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
												title={`Preview ${path}`}><ExternalLink size={16} aria-hidden="true" /></a
											><a
												class="grid min-h-11 min-w-11 place-items-center"
												href={`${mediaPath}?path=${encodeURIComponent(path)}&download=true`}
												download
												aria-label={`Download ${path}`}
												title={`Download ${path}`}><Download size={16} aria-hidden="true" /></a
											><button
												type="button"
												class="grid min-h-11 min-w-11 place-items-center"
												onclick={() => onmedia(path, 'open')}
												aria-label={`Open ${path}`}
												title={`Open ${path}`}><ExternalLink size={16} aria-hidden="true" /></button
											><button
												type="button"
												class="grid min-h-11 min-w-11 place-items-center"
												onclick={() => onmedia(path, 'reveal')}
												aria-label={`Reveal ${path}`}
												title={`Reveal ${path}`}><FolderOpen size={16} aria-hidden="true" /></button
											>
										</div>
									</article>{/each}
							</div>{/if}
						{#if message.role === 'assistant'}
							<div
								class="message markdown rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 leading-relaxed"
							>
								{#if message.images?.length}<div
										class="message-images mb-2 grid grid-cols-2 gap-1.5"
									>
										{#each message.images as image}<img
												src={`data:${image.mimeType};base64,${image.data}`}
												alt={image.name}
											/>{/each}
									</div>{/if}
								{@html renderMarkdown(message.text)}{#if index === timeline.length - 1 && busy}<span
										class="cursor animate-pulse text-violet-400">▋</span
									>{/if}
							</div>
						{:else}
							<div
								class="message user-message rounded-2xl rounded-tr-md border border-violet-900 bg-violet-950/50 px-4 py-3 leading-relaxed"
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
									onclick={() => onedit(message)}><Pencil size={14} aria-hidden="true" /></button
								>{/if}
							<button
								type="button"
								aria-label="Copy message"
								title="Copy message"
								onclick={() => oncopy(message)}><Copy size={14} aria-hidden="true" /></button
							>
							<button
								type="button"
								aria-label="Fork from this message unavailable"
								title="Hermes ACP can duplicate a full Session but cannot fork from a selected message"
								disabled><GitFork size={14} aria-hidden="true" /></button
							>
							{#if message.role === 'assistant' && index === timeline.length - 1}<button
									type="button"
									aria-label="Retry last response"
									title="Retry last response by resending previous user message"
									disabled={busy}
									onclick={onretrylast}>Retry</button
								>{/if}
							{#if validTimestamp(message.createdAt)}<time
									class="ml-1 text-xs text-muted-foreground"
									datetime={message.createdAt}
									title={timestampTitle(message.createdAt)}
									aria-label={timestampTitle(message.createdAt)}
									>{timestamp(message.createdAt)}</time
								>{/if}
						</div>
					</div>
				</article>
			{:else if item.kind === 'plan' && item.entries.length}<section
					data-timeline-sequence={item.sequence}
					class="todo-progress activity-card mx-auto mb-4 max-w-[774px] rounded-xl border border-border bg-card p-3"
					aria-label="Hermes todo progress"
				>
					<header class="flex items-center justify-between gap-3">
						<strong>Hermes todo</strong><span
							>{progress(item.entries)} of {item.entries.length}</span
						>{#if validTimestamp(item.createdAt)}<time
								datetime={item.createdAt}
								title={timestampTitle(item.createdAt)}
								aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
							>{/if}
					</header>
					<progress class="w-full" value={progress(item.entries)} max={item.entries.length}
						>{progress(item.entries)} of {item.entries.length}</progress
					>
					<ul>
						{#each item.entries as entry}<li class:completed={entry.status === 'completed'}>
								<span aria-hidden="true"
									>{entry.status === 'completed'
										? '✓'
										: entry.status === 'in_progress'
											? '◉'
											: '○'}</span
								>
								{entry.content}
							</li>{/each}
					</ul>
				</section>
			{:else if item.kind === 'thought' && item.sequence !== currentThought?.sequence}<details
					data-timeline-sequence={item.sequence}
					class="agent-thought mx-auto mb-6 max-w-[774px] border-l-2 border-border text-muted-foreground"
				>
					<summary
						>Hermes reasoning{#if validTimestamp(item.createdAt)}
							<time
								datetime={item.createdAt}
								title={timestampTitle(item.createdAt)}
								aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
							>{/if}</summary
					>
					<div class="markdown">{@html renderMarkdown(item.text)}</div>
				</details>
			{:else if item.kind === 'status'}<section
					data-timeline-sequence={item.sequence}
					class="mx-auto mb-4 max-w-[774px] rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground"
					aria-label={item.label}
				>
					<div class="flex items-center justify-between gap-3">
						<span>{item.label}</span>
						{#if validTimestamp(item.createdAt)}<time
								datetime={item.createdAt}
								title={timestampTitle(item.createdAt)}
								aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
							>{/if}
					</div>
				</section>
			{:else if item.kind === 'tool'}<details
					data-timeline-sequence={item.sequence}
					class="tool-card activity-card mx-auto mb-4 max-w-[774px] overflow-hidden rounded-xl border border-border bg-card"
					aria-label={item.title ?? item.name ?? 'Tool call'}
				>
					<summary
						><ChevronRight class="disclosure-icon" size={14} aria-hidden="true" /><strong
							>{item.title ?? item.name ?? 'Tool call'}</strong
						><span class="activity-status">{item.status.replace('_', ' ')}</span
						>{#if item.durationMs !== undefined}<span>{item.durationMs} ms</span
							>{/if}{#if validTimestamp(item.createdAt)}<time
								datetime={item.createdAt}
								title={timestampTitle(item.createdAt)}
								aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
							>{/if}</summary
					>
					<div class="activity-body">
						{#if item.args !== undefined}<strong>Arguments</strong>
							<pre>{serialized(item.args)}</pre>{/if}{#if item.result !== undefined}<strong
								>Result</strong
							>
							<pre>{serialized(item.result)}</pre>{/if}{#if item.error}<p
								class="text-destructive"
								role="alert"
							>
								{item.error}
							</p>{/if}
					</div>
				</details>
			{:else if item.kind === 'permission'}<section
					data-timeline-sequence={item.sequence}
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
					<p>{item.toolCall?.title ?? 'Hermes requests permission.'}</p>
					{#if item.toolCall?.args !== undefined}<pre>{serialized(item.toolCall.args)}</pre>{/if}
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
			{:else if item.kind === 'subagents'}
				<details
					data-timeline-sequence={item.sequence}
					class="subagent-tree mx-auto mb-6 max-w-[774px] overflow-hidden rounded-xl border border-border bg-card"
					aria-label={item.title}
					open
				>
					<summary
						><ChevronRight
							class="disclosure-icon shrink-0 text-muted-foreground"
							size={14}
							aria-hidden="true"
						/><span class="subagent-tree-title min-w-0 text-sm font-bold">{item.title}</span><span
							class="subagent-status ml-auto shrink-0 text-xs text-muted-foreground capitalize"
							class:active={item.status === 'in_progress'}>{item.status.replace('_', ' ')}</span
						>{#if validTimestamp(item.createdAt)}<time
								datetime={item.createdAt}
								title={timestampTitle(item.createdAt)}
								aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
							>{/if}</summary
					>
					<div class="subagent-children py-1">
						{#each item.children ?? [] as child (child.index)}<details class="subagent-child">
								<summary
									><ChevronRight
										class="disclosure-icon shrink-0 text-muted-foreground"
										size={14}
										aria-hidden="true"
									/><span class="subagent-branch" aria-hidden="true"></span><span
										class="subagent-goal min-w-0 break-words">{child.goal}</span
									>{#if child.role}<span class="subagent-role shrink-0 text-xs text-violet-300"
											>@{child.role}</span
										>{/if}<span
										class="subagent-status ml-auto shrink-0 text-xs text-muted-foreground capitalize"
										class:active={child.status === 'in_progress'}
										>{child.status.replace('_', ' ')}</span
									></summary
								>{#if child.result}<div
										class="subagent-result mx-3 mb-2.5 ml-8 border-l-2 border-border bg-background p-2.5 text-xs whitespace-pre-wrap text-muted-foreground"
									>
										{child.result}
									</div>{/if}
							</details>{/each}
					</div>
				</details>
			{/if}
		{/each}
		{#if busy}<LiquidThinkingOrb
				thought={currentThought?.text}
				sequence={currentThought?.sequence}
			/>{/if}
		{#if timeline.length === 0}<div
				class="welcome mx-auto mt-[12vh] max-w-2xl text-center text-muted-foreground"
			>
				<span>H</span>
				<h2>Start this Hermes Session</h2>
				<p>Your complete message is saved before HUE sends it.</p>
			</div>{/if}
		<div class="transcript-spacer h-[max(48px,10vh)]" aria-hidden="true"></div>
	</div>
</section>
