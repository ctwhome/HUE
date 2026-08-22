<script lang="ts">
	import { ChevronRight, Copy, GitFork, Pencil } from 'lucide-svelte';
	import type { ImageAttachment } from '$lib/message-content';
	import type { WorkspaceSubagentTree } from '$lib';

	type Message = { role: 'user' | 'assistant'; text: string; images?: ImageAttachment[] };

	let {
		messages,
		subagents,
		pendingThought,
		pendingAssistant,
		pendingImages,
		delivery,
		messageNotice,
		busy,
		renderMarkdown,
		onedit,
		oncopy,
		onfork,
		element = $bindable(),
		follow
	}: {
		messages: Message[];
		subagents: WorkspaceSubagentTree[];
		pendingThought: string;
		pendingAssistant: string;
		pendingImages: ImageAttachment[];
		delivery: string;
		messageNotice: string;
		busy: boolean;
		renderMarkdown: (text: string) => string;
		onedit: (message: Message) => void;
		oncopy: (message: Message) => void;
		onfork: () => void;
		element?: HTMLElement;
		follow: (node: HTMLElement) => { destroy: () => void };
	} = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
	class="transcript min-h-0 flex-1 overflow-auto overflow-x-hidden px-[clamp(20px,7vw,110px)] pt-8"
	aria-label="Conversation"
	aria-live="polite"
	tabindex="0"
	bind:this={element}
	use:follow
>
	<div class="transcript-content min-h-full">
		{#each messages as message}
			<article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'}>
				<div
					class="avatar grid h-8 min-w-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-bold text-violet-300"
				>
					{message.role === 'assistant' ? 'H' : 'You'}
				</div>
				<div class="message-stack grid min-w-0">
					{#if message.role === 'assistant'}
						<div
							class="message markdown rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 leading-relaxed"
						>
							{#if message.images?.length}<div class="message-images mb-2 grid grid-cols-2 gap-1.5">
									{#each message.images as image}<img
											src={`data:${image.mimeType};base64,${image.data}`}
											alt={image.name}
										/>{/each}
								</div>{/if}
							{@html renderMarkdown(message.text)}
						</div>
					{:else}
						<div
							class="message user-message rounded-2xl rounded-tr-md border border-violet-900 bg-violet-950/50 px-4 py-3 leading-relaxed"
						>
							{#if message.images?.length}<div class="message-images mb-2 grid grid-cols-2 gap-1.5">
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
							aria-label="Fork session"
							title="Fork current session"
							disabled={busy}
							onclick={onfork}><GitFork size={14} aria-hidden="true" /></button
						>
					</div>
				</div>
			</article>
		{/each}
		<span class="sr-only" aria-live="polite">{messageNotice}</span>
		{#each subagents as tree (tree.id)}
			<details
				class="subagent-tree mx-auto mb-6 max-w-[774px] overflow-hidden rounded-xl border border-border bg-card"
				aria-label={tree.title}
				open
			>
				<summary
					><ChevronRight
						class="disclosure-icon shrink-0 text-muted-foreground"
						size={14}
						aria-hidden="true"
					/><span class="subagent-tree-title min-w-0 text-sm font-bold">{tree.title}</span><span
						class="subagent-status ml-auto shrink-0 text-xs text-muted-foreground capitalize"
						class:active={tree.status === 'in_progress'}>{tree.status.replace('_', ' ')}</span
					></summary
				>
				<div class="subagent-children py-1">
					{#each tree.children as child (child.index)}<details class="subagent-child">
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
		{/each}
		{#if pendingThought}<details
				class="agent-thought mx-auto mb-6 max-w-[774px] border-l-2 border-border text-muted-foreground"
				open
			>
				<summary>Hermes reasoning</summary>
				<div class="markdown">{@html renderMarkdown(pendingThought)}</div>
			</details>{/if}
		{#if pendingAssistant || pendingImages.length}<article class="assistant">
				<div
					class="avatar grid h-8 min-w-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-bold text-violet-300"
				>
					H
				</div>
				<div
					class="message markdown rounded-2xl rounded-tl-md border border-border bg-card px-4 py-3 leading-relaxed"
				>
					{#if pendingImages.length}<div class="message-images mb-2 grid grid-cols-2 gap-1.5">
							{#each pendingImages as image}<img
									src={`data:${image.mimeType};base64,${image.data}`}
									alt={image.name}
								/>{/each}
						</div>{/if}{@html renderMarkdown(
						pendingAssistant
					)}{#if delivery === 'accepted' || delivery === 'running'}<span
							class="cursor animate-pulse text-violet-400">▋</span
						>{/if}
				</div>
			</article>{/if}
		{#if messages.length === 0 && !pendingAssistant && !pendingImages.length && !pendingThought}<div
				class="welcome mx-auto mt-[12vh] max-w-2xl text-center text-muted-foreground"
			>
				<span>H</span>
				<h2>Start this Hermes Session</h2>
				<p>Your complete message is saved before HUE sends it.</p>
			</div>{/if}
		<div class="transcript-spacer h-[max(48px,10vh)]" aria-hidden="true"></div>
	</div>
</section>
