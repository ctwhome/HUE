<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import Copy from '~icons/lucide/copy';
	import Sparkles from '~icons/lucide/sparkles';
	import X from '~icons/lucide/x';
	import { renderMessageMarkdown } from '$lib/message-markdown';
	import { workspaceApi } from './api';
	import { copyCode } from './copy-code';

	type QuickAskResult = {
		status: 'completed' | 'pending' | 'failed' | 'unknown';
		sessionId: string;
		messageId: string;
		answer?: string;
		path?: string;
		error?: string;
	};

	let dialog: HTMLDialogElement;
	let questionElement: HTMLTextAreaElement;
	let question = $state('');
	let answer = $state('');
	let operationId = $state('');
	let sessionPath = $state('');
	let status = $state<QuickAskResult['status'] | 'idle'>('idle');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let confirmingStop = $state(false);

	export async function open() {
		question = '';
		answer = '';
		operationId = '';
		sessionPath = '';
		status = 'idle';
		busy = false;
		error = '';
		notice = '';
		confirmingStop = false;
		if (!dialog.open) dialog.showModal();
		await tick();
		questionElement.focus();
	}

	async function ask(event?: SubmitEvent) {
		event?.preventDefault();
		if (!question.trim() || busy) return;
		operationId ||= crypto.randomUUID();
		busy = true;
		error = '';
		notice = '';
		try {
			const result = await workspaceApi<QuickAskResult>('/api/quick-ask', {
				method: 'POST',
				body: JSON.stringify({ question, operationId })
			});
			status = result.status;
			answer = result.answer ?? '';
			sessionPath = result.path ?? '';
			error = result.error ?? '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!operationId) {
			dialog.close();
			return;
		}
		busy = true;
		error = '';
		try {
			await workspaceApi('/api/quick-ask', {
				method: 'DELETE',
				body: JSON.stringify({ operationId })
			});
			dialog.close();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
			confirmingStop = false;
		}
	}

	function close() {
		if (busy) return;
		if (status === 'pending') {
			confirmingStop = true;
			return;
		}
		void remove();
	}

	async function keep() {
		if (!operationId || busy) return;
		busy = true;
		error = '';
		try {
			const result = await workspaceApi<{ path: string }>('/api/quick-ask', {
				method: 'PATCH',
				body: JSON.stringify({ operationId })
			});
			dialog.close();
			await goto(result.path);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="m-auto max-h-[calc(100dvh-1rem)] w-[min(640px,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/70"
	aria-labelledby="quick-ask-title"
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
>
	<header class="flex items-start gap-3 border-b border-border p-4 pr-3">
		<div class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
			<Sparkles width={20} height={20} aria-hidden="true" />
		</div>
		<div class="min-w-0 flex-1">
			<h2 id="quick-ask-title" class="font-semibold">Quick Ask</h2>
			<p class="text-sm text-muted-foreground">Ask a one-off question. It won’t appear in Chats.</p>
		</div>
		<button
			type="button"
			class="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-accent"
			aria-label={operationId ? 'Close and remove' : 'Close Quick Ask'}
			title={operationId ? 'Close and remove' : 'Close'}
			disabled={busy}
			onclick={close}><X width={18} height={18} aria-hidden="true" /></button
		>
	</header>
	<form class="grid gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onsubmit={ask}>
		<label class="grid gap-1.5 text-sm font-medium">
			Your question
			<textarea
				bind:this={questionElement}
				bind:value={question}
				maxlength="20000"
				rows="4"
				placeholder="What would you like to know?"
				class="min-h-28 resize-y rounded-xl border border-input bg-background p-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
				disabled={busy || Boolean(answer)}
			></textarea>
		</label>
		<p class="text-xs text-muted-foreground">Hermes still keeps a transcript in its session history.</p>

		{#if answer}<section class="grid gap-3 rounded-xl border border-border bg-background p-4" aria-label="Quick Ask answer">
				<div class="message-markdown min-w-0 text-sm">{@html renderMessageMarkdown(answer)}</div>
				{#if notice}<p class="text-xs text-muted-foreground" role="status">{notice}</p>{/if}
			</section>{/if}
		{#if status === 'pending'}<p class="rounded-lg bg-accent p-3 text-sm" role="status">
				Hermes is still answering.
				{#if sessionPath}<a class="ml-1 underline" href={sessionPath}>Open Session</a>{/if}
			</p>{/if}
		{#if status === 'unknown'}<p class="rounded-lg bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] p-3 text-sm text-[var(--warning)]" role="alert">
				Hermes may have received your question, but HUE can’t confirm the outcome. It was not sent again.
			</p>{/if}
		{#if error}<p class="rounded-lg bg-destructive/15 p-3 text-sm text-destructive" role="alert">{error}</p>{/if}

		{#if confirmingStop}<div class="grid gap-3 rounded-xl border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-3">
				<div>
					<strong class="text-sm">Stop this Quick Ask?</strong>
					<p class="text-sm text-muted-foreground">The answer may be incomplete.</p>
				</div>
				<div class="flex flex-wrap justify-end gap-2">
					<button type="button" class="min-h-11 rounded-lg border border-border px-4" onclick={() => (confirmingStop = false)}>Keep open</button>
					<button type="button" class="min-h-11 rounded-lg bg-destructive px-4 text-destructive-foreground" onclick={remove}>Stop and remove</button>
				</div>
			</div>{:else}<footer class="flex flex-wrap justify-end gap-2">
				{#if answer}<button
						type="button"
						class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4"
						onclick={() => copyCode(answer, (message) => (notice = message), 'Answer copied')}
						><Copy width={16} height={16} aria-hidden="true" />Copy</button
					>
					<button type="button" class="min-h-11 rounded-lg border border-border px-4" disabled={busy} onclick={keep}>Keep as Chat</button>
					<button type="button" class="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50" disabled={busy} onclick={close}>Close and remove</button>
				{:else if status === 'pending'}<button type="button" class="min-h-11 rounded-lg border border-border px-4" disabled={busy} onclick={close}>Close and remove</button>
					<button type="button" class="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50" disabled={busy} onclick={() => ask()}>{busy ? 'Checking…' : 'Check again'}</button>
				{:else}<button type="button" class="min-h-11 rounded-lg border border-border px-4" disabled={busy} onclick={close}>Close</button>
					<button type="submit" class="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50" disabled={busy || !question.trim()}>{busy ? 'Asking…' : 'Ask Hermes'}</button>
				{/if}
			</footer>{/if}
	</form>
</dialog>
