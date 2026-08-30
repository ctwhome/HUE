<script lang="ts">
	import ArrowLeft from '~icons/lucide/arrow-left';
	import CalendarClock from '~icons/lucide/calendar-clock';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import Textarea from '../ui/Textarea.svelte';
	import { workspaceApi } from './api';
	import type { ExternalCronJob } from './types';

	type Detail = ExternalCronJob & {
		prompt: string;
		deliver: string;
		model: string;
		provider: string;
		scriptOnly: boolean;
	};

	let {
		job,
		mobile,
		onback,
		onupdated,
		ondeleted
	}: {
		job: ExternalCronJob;
		mobile: boolean;
		onback: (trigger: HTMLElement) => void;
		onupdated: (job: Detail) => void;
		ondeleted: (job: ExternalCronJob) => void;
	} = $props();

	let detail = $state<Detail | null>(null);
	let name = $state('');
	let prompt = $state('');
	let schedule = $state('');
	let deliver = $state('local');
	let model = $state('');
	let provider = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let saved = $state(false);
	let removeOpen = $state(false);
	let removeConfirmation = $state('');
	let loadedKey = '';
	const path = () =>
		`/api/hermes/cron/${encodeURIComponent(job.jobId)}?profile=${encodeURIComponent(job.profile)}`;

	$effect(() => {
		const key = `${job.profile}:${job.jobId}`;
		if (loadedKey === key) return;
		loadedKey = key;
		loading = true;
		error = '';
		void workspaceApi<{ job: Detail }>(path())
			.then(({ job: loaded }) => {
				detail = loaded;
				name = loaded.name;
				prompt = loaded.prompt;
				schedule = loaded.schedule;
				deliver = loaded.deliver;
				model = loaded.model;
				provider = loaded.provider;
			})
			.catch((cause) => (error = cause instanceof Error ? cause.message : String(cause)))
			.finally(() => (loading = false));
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		error = '';
		saved = false;
		try {
			const response = await workspaceApi<{ job: Detail }>(path(), {
				method: 'PUT',
				body: JSON.stringify({
					updates: { name, prompt, schedule, deliver, model, provider }
				})
			});
			detail = response.job;
			onupdated(response.job);
			saved = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function toggleEnabled() {
		if (!detail) return;
		saving = true;
		error = '';
		try {
			const response = await workspaceApi<{ job: Detail }>(path(), {
				method: 'PUT',
				body: JSON.stringify({ enabled: !detail.enabled })
			});
			detail = response.job;
			onupdated(response.job);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (removeConfirmation !== job.jobId) return;
		saving = true;
		error = '';
		try {
			await workspaceApi(`${path()}&confirm=${encodeURIComponent(job.jobId)}`, {
				method: 'DELETE'
			});
			ondeleted(job);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			saving = false;
		}
	}
</script>

<main class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="Cron job editor">
	<header class="flex min-h-14 items-center gap-2 border-b border-border px-3 sm:px-5">
		{#if mobile}<button
				class="grid size-11 shrink-0 place-items-center rounded-md hover:bg-accent"
				aria-label="Back to Cron tasks"
				title="Back to Cron tasks"
				onclick={(event) => onback(event.currentTarget)}
				><ArrowLeft width={20} height={20} aria-hidden="true" /></button
			>{/if}
		<CalendarClock class="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
		<div class="min-w-0 flex-1">
			<h1 class="truncate font-semibold">{job.name}</h1>
			<p class="truncate text-xs text-muted-foreground">Hermes cron · {job.profileName}</p>
		</div>
		<span class="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
			>{detail?.enabled ?? job.enabled ? (detail?.state ?? job.state) : 'paused'}</span
		>
	</header>

	<div class="min-h-0 flex-1 overflow-auto p-4 sm:p-8">
		<div class="mx-auto grid max-w-3xl gap-6">
			<div class="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
				This job is owned and executed by Hermes. Changes here update Hermes directly; HUE does not
				provide delivery guarantees or completion notifications for it.
			</div>

			{#if error}<p class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{error}
				</p>{/if}
			{#if loading}<p class="text-sm text-muted-foreground" role="status">Loading job…</p>{/if}

			{#if detail}<form class="grid gap-5" onsubmit={save}>
					<label class="grid gap-1.5 text-sm font-medium">Name
						<Input bind:value={name} maxlength={200} required />
					</label>
					<label class="grid gap-1.5 text-sm font-medium">Schedule
						<Input bind:value={schedule} maxlength={256} required />
						<small class="font-normal text-muted-foreground">Cron, interval, or one-time expression accepted by Hermes.</small>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">Prompt
						<Textarea bind:value={prompt} class="min-h-40 resize-y" maxlength={100000} required={!detail.scriptOnly} />
					</label>
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="grid gap-1.5 text-sm font-medium">Delivery
							<Input bind:value={deliver} maxlength={1000} required />
						</label>
						<label class="grid gap-1.5 text-sm font-medium">Model override
							<Input bind:value={model} maxlength={256} placeholder="Use profile default" />
						</label>
					</div>
					<label class="grid gap-1.5 text-sm font-medium sm:max-w-[calc(50%-0.5rem)]">Provider override
						<Input bind:value={provider} maxlength={128} placeholder="Use profile default" />
					</label>
					<div class="flex flex-wrap items-center gap-2">
						<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
						<Button type="button" variant="outline" disabled={saving} onclick={toggleEnabled}
							>{detail.enabled ? 'Pause job' : 'Resume job'}</Button
						>
						{#if saved}<span class="text-sm text-[var(--success)]" role="status">Saved</span>{/if}
					</div>
				</form>

				<section class="grid gap-3 border-t border-border pt-6" aria-label="Remove cron job">
					<h2 class="font-semibold">Remove job</h2>
					<p class="text-sm text-muted-foreground">This permanently deletes the job from Hermes. Existing run transcripts are not deleted.</p>
					{#if !removeOpen}<Button variant="destructive" class="w-fit" onclick={() => (removeOpen = true)}>Remove job</Button>
					{:else}<div class="grid max-w-md gap-3 rounded-lg border border-destructive/40 p-3">
							<label class="grid gap-1.5 text-sm">Type <code>{job.jobId}</code> to confirm
								<Input bind:value={removeConfirmation} autocomplete="off" />
							</label>
							<div class="flex gap-2">
								<Button variant="destructive" disabled={saving || removeConfirmation !== job.jobId} onclick={remove}>Delete permanently</Button>
								<Button variant="outline" disabled={saving} onclick={() => (removeOpen = false)}>Cancel</Button>
							</div>
						</div>{/if}
				</section>
			{/if}
		</div>
	</div>
</main>
