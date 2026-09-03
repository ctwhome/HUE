<script lang="ts">
	import ArrowLeft from '~icons/lucide/arrow-left';
	import CalendarClock from '~icons/lucide/calendar-clock';
	import CircleCheck from '~icons/lucide/circle-check';
	import CircleHelp from '~icons/lucide/circle-help';
	import CircleX from '~icons/lucide/circle-x';
	import Copy from '~icons/lucide/copy';
	import Download from '~icons/lucide/download';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import { renderMessageMarkdown } from '$lib/message-markdown';
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
	type Run = {
		sessionId: string;
		status: 'completed' | 'failed' | 'unknown';
		startedAt: string;
		endedAt: string | null;
		endReason: string | null;
		messageCount: number;
		readAt: string | null;
	};
	type TranscriptMessage = {
		role: 'user' | 'assistant';
		text: string;
		createdAt?: string;
	};

	let {
		job,
		mobile,
		onback,
		onupdated,
		onread,
		ondeleted
	}: {
		job: ExternalCronJob;
		mobile: boolean;
		onback: (trigger: HTMLElement) => void;
		onupdated: (job: Detail) => void;
		onread: () => void;
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
	let detailError = $state('');
	let saved = $state(false);
	let removeOpen = $state(false);
	let removeConfirmation = $state('');
	let tab = $state<'runs' | 'settings'>('runs');
	let runs = $state<Run[]>([]);
	let runsLoading = $state(true);
	let selectedRunId = $state('');
	let messages = $state<TranscriptMessage[]>([]);
	let transcriptLoading = $state(false);
	let reportNotice = $state('');
	let loadedKey = '';
	let finalReportIndex = $derived(messages.findLastIndex(({ role }) => role === 'assistant'));
	let finalReport = $derived(finalReportIndex < 0 ? null : messages[finalReportIndex]);
	let earlierMessages = $derived(messages.filter((_, index) => index !== finalReportIndex));
	const path = () =>
		`/api/hermes/cron/${encodeURIComponent(job.jobId)}?profile=${encodeURIComponent(job.profile)}`;
	const runsPath = () =>
		`/api/hermes/cron/${encodeURIComponent(job.jobId)}/runs?profile=${encodeURIComponent(job.profile)}`;
	const renderMarkdown = (text: string) =>
		renderMessageMarkdown(text)
			.replaceAll(
				'<table>',
				'<div class="table-block table-wrap"><div class="table-scroll"><table>'
			)
			.replaceAll('</table>', '</table></div></div>');

	async function loadDetail(key: string) {
		loading = true;
		detailError = '';
		try {
			const { job: loaded } = await workspaceApi<{ job: Detail }>(path());
			if (loadedKey !== key) return;
			detail = loaded;
			name = loaded.name;
			prompt = loaded.prompt;
			schedule = loaded.schedule;
			deliver = loaded.deliver;
			model = loaded.model;
			provider = loaded.provider;
		} catch (cause) {
			if (loadedKey === key) detailError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (loadedKey === key) loading = false;
		}
	}

	$effect(() => {
		const key = `${job.profile}:${job.jobId}`;
		if (loadedKey === key) return;
		loadedKey = key;
		detail = null;
		runs = [];
		messages = [];
		reportNotice = '';
		selectedRunId = '';
		tab = 'runs';
		runsLoading = true;
		error = '';
		void loadDetail(key);
		void workspaceApi<{ runs: Run[] }>(runsPath())
			.then(async ({ runs: loaded }) => {
				if (loadedKey !== key) return;
				runs = loaded;
				const requested = new URL(window.location.href).searchParams.get('cronRun');
				const run =
					loaded.find(({ sessionId }) => sessionId === requested) ??
					loaded.find(({ status }) => status === 'completed');
				if (run) await openRun(run, false);
			})
			.catch((cause) => (error = cause instanceof Error ? cause.message : String(cause)))
			.finally(() => {
				if (loadedKey === key) runsLoading = false;
			});
	});

	async function openRun(run: Run, navigate = true) {
		selectedRunId = run.sessionId;
		messages = [];
		reportNotice = '';
		transcriptLoading = true;
		error = '';
		if (navigate) {
			const url = new URL(window.location.href);
			url.searchParams.set('cronRun', run.sessionId);
			pushState(url, page.state);
		}
		const selected = run.sessionId;
		const runPath = `/api/hermes/cron/${encodeURIComponent(job.jobId)}/runs/${encodeURIComponent(run.sessionId)}?profile=${encodeURIComponent(job.profile)}`;
		try {
			const body = await workspaceApi<{ messages: TranscriptMessage[] }>(runPath);
			if (selectedRunId !== selected) return;
			messages = body.messages;
			if (!run.readAt) {
				await workspaceApi(runPath, { method: 'PUT' });
				runs = runs.map((item) =>
					item.sessionId === run.sessionId ? { ...item, readAt: new Date().toISOString() } : item
				);
				onread();
			}
		} catch (cause) {
			if (selectedRunId === selected)
				error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (selectedRunId === selected) transcriptLoading = false;
		}
	}

	async function copyReport() {
		if (!finalReport) return;
		try {
			await navigator.clipboard.writeText(finalReport.text);
			reportNotice = 'Report copied.';
		} catch {
			reportNotice = 'Could not copy report.';
		}
	}

	function downloadReport() {
		if (!finalReport) return;
		const url = URL.createObjectURL(new Blob([finalReport.text], { type: 'text/markdown' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `${(name || job.name).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'cron-report'}.md`;
		link.click();
		URL.revokeObjectURL(url);
	}

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

<main
	class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
	aria-label="Cron job editor"
>
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
			<h1 class="truncate font-semibold">{name || job.name}</h1>
			<p class="truncate text-xs text-muted-foreground">Hermes cron · {job.profileName}</p>
		</div>
		<span class="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
			>{(detail?.enabled ?? job.enabled) ? (detail?.state ?? job.state) : 'paused'}</span
		>
	</header>
	<nav class="flex border-b border-border px-3 sm:px-5" aria-label="Cron job sections">
		<button
			class="min-h-11 border-b-2 px-3 text-sm font-medium"
			class:border-primary={tab === 'runs'}
			class:border-transparent={tab !== 'runs'}
			aria-current={tab === 'runs' ? 'page' : undefined}
			onclick={() => (tab = 'runs')}
			>Runs{runs.some(({ readAt }) => !readAt)
				? ` (${runs.filter(({ readAt }) => !readAt).length})`
				: ''}</button
		>
		<button
			class="min-h-11 border-b-2 px-3 text-sm font-medium"
			class:border-primary={tab === 'settings'}
			class:border-transparent={tab !== 'settings'}
			aria-current={tab === 'settings' ? 'page' : undefined}
			onclick={() => (tab = 'settings')}>Settings</button
		>
	</nav>

	<div class="min-h-0 flex-1 overflow-auto p-4 sm:p-8" aria-label="Cron job content">
		{#if error}<p
				class="mx-auto mb-4 max-w-5xl rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
				role="alert"
			>
				{error}
			</p>{/if}
		{#if tab === 'runs'}<div
				class="mx-auto grid max-w-5xl gap-4 min-[1200px]:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]"
			>
				<label
					class="sticky top-4 z-10 grid min-w-0 gap-1.5 bg-background pb-2 text-sm font-medium min-[1200px]:hidden sm:top-8"
				>
					Run
					<select
						class="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label="Run"
						value={runs.some(({ sessionId }) => sessionId === selectedRunId) ? selectedRunId : ''}
						onchange={(event) => {
							const run = runs.find(
								({ sessionId }) => sessionId === (event.currentTarget as HTMLSelectElement).value
							);
							if (run) void openRun(run);
						}}
					>
						<option value="" disabled>Select a run</option>
						{#each runs as run (run.sessionId)}<option value={run.sessionId}
								>{run.status} · {new Date(run.startedAt).toLocaleString()} · {run.messageCount}
								messages</option
							>{/each}
					</select>
				</label>
				<section
					class="sticky top-8 hidden min-w-0 content-start gap-2 self-start overflow-hidden min-[1200px]:grid"
					aria-label="Cron run history"
				>
					{#if runsLoading}<p class="text-sm text-muted-foreground" role="status">
							Refreshing runs…
						</p>
					{:else if runs.length === 0}<p
							class="rounded-lg border border-border p-4 text-sm text-muted-foreground"
						>
							No Hermes runs found.
						</p>
					{:else}{#each runs as run (run.sessionId)}<button
								class="grid min-h-14 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border p-3 text-left hover:bg-accent"
								class:bg-accent={selectedRunId === run.sessionId}
								aria-current={selectedRunId === run.sessionId ? 'page' : undefined}
								onclick={() => openRun(run)}
							>
								{#if run.status === 'completed'}<CircleCheck
										class="text-[var(--success)]"
										width={18}
										height={18}
										aria-hidden="true"
									/>
								{:else if run.status === 'failed'}<CircleX
										class="text-destructive"
										width={18}
										height={18}
										aria-hidden="true"
									/>
								{:else}<CircleHelp
										class="text-[var(--warning)]"
										width={18}
										height={18}
										aria-hidden="true"
									/>{/if}
								<span class="min-w-0"
									><strong class="block truncate text-sm capitalize">{run.status}</strong><small
										class="block truncate text-muted-foreground"
										>{new Date(run.startedAt).toLocaleString()} · {run.messageCount} messages</small
									></span
								>
								{#if !run.readAt}<span
										class="size-2 rounded-full bg-destructive"
										aria-label="Unread run"
									></span>{/if}
							</button>{/each}{/if}
				</section>
				<section
					class="min-h-64 min-w-0 overflow-hidden rounded-lg border border-border bg-muted/20"
					aria-label="Cron run transcript"
				>
					{#if transcriptLoading}<p class="p-4 text-sm text-muted-foreground" role="status">
							Loading transcript…
						</p>
					{:else if !selectedRunId}<p class="p-4 text-sm text-muted-foreground">
							Select a run to read its Hermes transcript.
						</p>
					{:else if messages.length === 0}<p class="p-4 text-sm text-muted-foreground">
							This run has no transcript messages.
						</p>
					{:else}<div class="grid min-w-0 gap-4 p-4 sm:p-6">
							{#if finalReport}<article class="grid min-w-0 gap-3" aria-label="Final report">
									<header class="flex flex-wrap items-center justify-between gap-2">
										<strong class="text-xs tracking-wide text-muted-foreground uppercase"
											>Report</strong
										>
										<div class="flex items-center gap-1">
											<button
												class="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent"
												aria-label="Copy report Markdown"
												title="Copy report Markdown"
												onclick={copyReport}
												><Copy width={16} height={16} aria-hidden="true" />Copy</button
											>
											<button
												class="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent"
												aria-label="Download report Markdown"
												title="Download report Markdown"
												onclick={downloadReport}
												><Download width={16} height={16} aria-hidden="true" />Download</button
											>
										</div>
									</header>
									{#if reportNotice}<p class="text-sm text-muted-foreground" role="status">
											{reportNotice}
										</p>{/if}
									<div class="message markdown min-w-0 text-sm leading-6">
										{@html renderMarkdown(finalReport.text)}
									</div>
								</article>{/if}
							{#if earlierMessages.length}<details
									class="min-w-0 rounded-lg border border-border bg-muted/30"
								>
									<summary class="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium"
										>Earlier messages ({earlierMessages.length})</summary
									>
									<div class="grid min-w-0 gap-4 border-t border-border p-3">
										{#each earlierMessages as message, index (`${message.role}:${message.createdAt ?? index}`)}<article
												class="grid min-w-0 gap-1"
												aria-label={`${message.role} message`}
											>
												{#if message.role === 'user'}<details
														class="min-w-0 rounded-lg border border-border bg-background"
													>
														<summary class="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium"
															>Cron prompt</summary
														>
														<div
															class="message markdown min-w-0 border-t border-border p-3 text-sm leading-6"
														>
															{@html renderMarkdown(message.text)}
														</div>
													</details>
												{:else}<strong class="text-xs tracking-wide text-muted-foreground uppercase"
														>Intermediate response</strong
													>
													<div class="message markdown min-w-0 text-sm leading-6">
														{@html renderMarkdown(message.text)}
													</div>{/if}
											</article>{/each}
									</div>
								</details>{/if}
						</div>{/if}
				</section>
			</div>
		{:else}<div class="mx-auto grid max-w-3xl gap-6">
				<div class="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
					This job is owned and executed by Hermes. Changes here update Hermes directly; HUE does
					not provide delivery guarantees. HUE checks Hermes periodically and notifies you when it
					discovers a finished run.
				</div>
				{#if detailError}<div class="grid gap-3">
						<p
							class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
							role="alert"
						>
							{detailError}
						</p>
						<Button
							type="button"
							variant="outline"
							class="w-fit"
							disabled={loading}
							onclick={() => void loadDetail(loadedKey)}>Retry</Button
						>
					</div>{/if}
				{#if loading}<p class="text-sm text-muted-foreground" role="status">Loading job…</p>{/if}

				{#if detail}<form class="grid gap-5" onsubmit={save}>
						<label class="grid gap-1.5 text-sm font-medium"
							>Name
							<Input bind:value={name} maxlength={200} required />
						</label>
						<label class="grid gap-1.5 text-sm font-medium"
							>Schedule
							<Input bind:value={schedule} maxlength={256} required />
							<small class="font-normal text-muted-foreground"
								>Cron, interval, or one-time expression accepted by Hermes.</small
							>
						</label>
						<label class="grid gap-1.5 text-sm font-medium"
							>Prompt
							<Textarea
								bind:value={prompt}
								class="min-h-40 resize-y"
								maxlength={100000}
								required={!detail.scriptOnly}
							/>
						</label>
						<div class="grid gap-4 sm:grid-cols-2">
							<label class="grid gap-1.5 text-sm font-medium"
								>Delivery
								<Input bind:value={deliver} maxlength={1000} required />
							</label>
							<label class="grid gap-1.5 text-sm font-medium"
								>Model override
								<Input bind:value={model} maxlength={256} placeholder="Use profile default" />
							</label>
						</div>
						<label class="grid gap-1.5 text-sm font-medium sm:max-w-[calc(50%-0.5rem)]"
							>Provider override
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
						<p class="text-sm text-muted-foreground">
							This permanently deletes the job from Hermes. Existing run transcripts are not
							deleted.
						</p>
						{#if !removeOpen}<Button
								variant="destructive"
								class="w-fit"
								onclick={() => (removeOpen = true)}>Remove job</Button
							>
						{:else}<div class="grid max-w-md gap-3 rounded-lg border border-destructive/40 p-3">
								<label class="grid gap-1.5 text-sm"
									>Type <code>{job.jobId}</code> to confirm
									<Input bind:value={removeConfirmation} autocomplete="off" />
								</label>
								<div class="flex gap-2">
									<Button
										variant="destructive"
										disabled={saving || removeConfirmation !== job.jobId}
										onclick={remove}>Delete permanently</Button
									>
									<Button variant="outline" disabled={saving} onclick={() => (removeOpen = false)}
										>Cancel</Button
									>
								</div>
							</div>{/if}
					</section>
				{/if}
			</div>{/if}
	</div>
</main>
