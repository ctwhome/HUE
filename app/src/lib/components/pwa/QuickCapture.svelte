<script lang="ts">
	import { tick } from 'svelte';
	import { Lightbulb, X } from 'lucide-svelte';
	import type { ImageAttachment, InputAttachment } from '$lib/message-content';
	import { captureDraftStorage, splitCaptureAttachments } from '$lib/pwa/quick-capture';
	import type { Project } from '$lib/components/workspace/types';

	let {
		projects,
		oncreate
	}: {
		projects: Project[];
		oncreate: (capture: {
			projectId: string | null;
			text: string;
			images: ImageAttachment[];
			attachments: InputAttachment[];
		}) => Promise<boolean>;
	} = $props();
	let dialog: HTMLDialogElement;
	let composerElement: HTMLTextAreaElement;
	let text = $state('');
	let projectId = $state('');
	let attachments = $state<InputAttachment[]>([]);
	let busy = $state(false);
	let loadingShare = $state(false);
	let error = $state('');

	function persist() {
		captureDraftStorage(localStorage).write({ text, projectId: projectId || null });
	}

	export async function open(intent: 'capture' | 'share' = 'capture', token: string | null = null) {
		const saved = captureDraftStorage(localStorage).read();
		text = saved.text;
		projectId = projects.some(({ id, rootAvailable }) => rootAvailable && id === saved.projectId)
			? (saved.projectId ?? '')
			: '';
		error = '';
		if (!dialog.open) dialog.showModal();
		await tick();
		composerElement.focus();
		if (intent !== 'share') return;
		if (!token) {
			error = 'Shared content is unavailable. Paste or reattach it here.';
			return;
		}
		loadingShare = true;
		try {
			const response = await fetch(`/api/share-intake/${encodeURIComponent(token)}`, {
				headers: { accept: 'application/json' },
				cache: 'no-store'
			});
			if (!response.ok) throw new Error('Shared content expired or was already opened.');
			const intake = (await response.json()) as { text: string; attachments: InputAttachment[] };
			text = [text.trim(), intake.text.trim()].filter(Boolean).join('\n\n');
			attachments = intake.attachments;
			persist();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loadingShare = false;
			await tick();
			composerElement.focus();
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			const split = splitCaptureAttachments(attachments);
			if (
				await oncreate({
					projectId: projectId || null,
					text,
					images: split.images,
					attachments: split.attachments
				})
			) {
				captureDraftStorage(localStorage).clear();
				text = '';
				attachments = [];
				dialog.close();
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	function close() {
		persist();
		attachments = [];
		dialog.close();
	}
</script>

<dialog
	bind:this={dialog}
	class="m-auto max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-1rem))] overflow-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/70"
	aria-labelledby="quick-capture-title"
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
>
	<header class="flex items-start gap-3 border-b border-border p-4 pr-3">
		<div class="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-950 text-violet-200">
			<Lightbulb aria-hidden="true" />
		</div>
		<div class="min-w-0 flex-1">
			<h2 id="quick-capture-title" class="font-semibold">Quick Idea</h2>
			<p class="text-sm text-muted-foreground">
				Create a Session with this draft. Nothing sends automatically.
			</p>
		</div>
		<button
			class="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-accent"
			aria-label="Close quick capture"
			title="Close"
			onclick={close}><X aria-hidden="true" /></button
		>
	</header>
	<form class="grid gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onsubmit={create}>
		<label class="grid gap-1.5 text-sm"
			><span class="text-muted-foreground">Session Project</span><select
				bind:value={projectId}
				onchange={persist}
				class="min-h-11 rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
				><option value="">No Project</option
				>{#each projects.filter(({ rootAvailable }) => rootAvailable) as project}<option
						value={project.id}>{project.name}</option
					>{/each}</select
			></label
		>
		<label class="grid gap-1.5 text-sm"
			><span class="text-muted-foreground">Idea or message draft</span><textarea
				bind:this={composerElement}
				bind:value={text}
				oninput={persist}
				maxlength="16000"
				rows="6"
				placeholder="Capture without sending…"
				class="min-h-32 resize-y rounded-xl border border-input bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
			></textarea></label
		>
		{#if loadingShare}<p class="text-sm text-muted-foreground" role="status">
				Opening shared content…
			</p>{/if}
		{#if attachments.length}<section
				class="grid gap-2 rounded-lg border border-border bg-background p-3"
				aria-label="Shared files"
			>
				<strong class="text-sm">Shared files</strong>{#each attachments as attachment}<span
						class="truncate text-sm"
						>{attachment.name} · {Math.max(1, Math.ceil(attachment.size / 1024))} KB</span
					>{/each}<small class="text-muted-foreground"
					>Files stay only in this open capture. If you close or reload, reattach them.</small
				>
			</section>{/if}
		{#if error}<p class="rounded-lg bg-destructive/15 p-3 text-sm text-destructive" role="alert">
				{error}
			</p>{/if}
		<div class="flex flex-wrap justify-end gap-2">
			<button type="button" class="min-h-11 rounded-lg border border-border px-4" onclick={close}
				>Keep draft for later</button
			><button
				type="submit"
				class="min-h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50"
				disabled={busy || loadingShare}>{busy ? 'Creating…' : 'Create Session'}</button
			>
		</div>
	</form>
</dialog>
