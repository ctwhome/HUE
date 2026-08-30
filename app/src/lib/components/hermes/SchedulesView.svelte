<script lang="ts">
	import { parseApiResponse } from '$lib/api-response';
	import Input from '../ui/Input.svelte';
	import Button from '../ui/Button.svelte';
	import type { Job } from './types';

	let {
		jobs,
		onaction
	}: {
		jobs: Job[];
		onaction: (action: string, input: Record<string, unknown>) => Promise<unknown>;
	} = $props();
	let filter = $state('');
	let status = $state('all');
	let scheduleGroup = $state<'none' | 'status'>('none');
	let newName = $state('');
	let newPrompt = $state('');
	let newSchedule = $state('0 9 * * *');
	let historyJob = $state('');
	let history = $state<Record<string, unknown> | null>(null);
	let historyError = $state('');
	const inputClass =
		'h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring max-[700px]:min-h-11';
	const card = 'rounded-xl border border-border bg-card p-4';
	const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
	const jobStatuses = () =>
		[...new Set(jobs.map((job) => job.status))].sort((a, b) => a.localeCompare(b));
	const filteredJobs = () => {
		const query = filter.trim().toLowerCase();
		return jobs.filter(
			(job) =>
				(!query ||
					`${job.name || job.id} ${job.cron} ${job.status} ${job.nextRun || ''}`
						.toLowerCase()
						.includes(query)) &&
				(status === 'all' || job.status === status)
		);
	};
	const jobGroups = () => {
		const items = filteredJobs();
		if (scheduleGroup === 'none') return [{ name: '', jobs: items }];
		return [...Map.groupBy(items, (job) => label(job.status)).entries()]
			.map(([name, grouped]) => ({ name, jobs: grouped }))
			.sort((a, b) => a.name.localeCompare(b.name));
	};
	async function loadHistory(job: Job) {
		historyJob = job.id;
		history = null;
		historyError = '';
		try {
			const response = await fetch(
				`/api/hermes/admin?view=schedules&detail=schedule&id=${encodeURIComponent(job.id)}`
			);
			const result = await parseApiResponse<Record<string, unknown>>(response);
			if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
			history = result;
		} catch (cause) {
			historyError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	function editJob(job: Job) {
		const name = window.prompt('Schedule name', job.name ?? job.id);
		if (name === null) return;
		const promptText = window.prompt('Schedule prompt', job.prompt ?? '');
		if (promptText === null) return;
		const cron = window.prompt('Cron schedule', job.cron);
		if (cron === null) return;
		void onaction('schedule.update', {
			id: job.id,
			updates: { name, prompt: promptText, cron }
		});
	}
</script>

<form
	class="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-4 max-[700px]:grid-cols-1"
	onsubmit={(event) => {
		event.preventDefault();
		void onaction('schedule.create', {
			name: newName,
			prompt: newPrompt,
			cron: newSchedule
		});
	}}
>
	<Input bind:value={newName} aria-label="Schedule name" placeholder="Schedule name" required />
	<Input bind:value={newSchedule} aria-label="Cron schedule" placeholder="0 9 * * *" required />
	<Input
		bind:value={newPrompt}
		class="max-[700px]:col-span-1"
		aria-label="Schedule prompt"
		placeholder="Prompt"
		required
	/>
	<Button type="submit">Create schedule</Button>
</form>

<section
	class="skill-statistics schedule-statistics grid grid-cols-3 gap-2 max-[700px]:grid-cols-2"
	aria-label="Schedule statistics"
>
	{#each [[jobs.length, 'Jobs', `${jobs.length} scheduled jobs`], [jobs.filter((job) => job.status === 'active').length, 'Active', `${jobs.filter((job) => job.status === 'active').length} active jobs`], [jobs.filter((job) => job.status !== 'active').length, 'Inactive', `${jobs.filter((job) => job.status !== 'active').length} inactive jobs`]] as stat}
		<article class={`${card} grid gap-0.5`} aria-label={String(stat[2])}>
			<strong class="text-xl">{stat[0]}</strong><span class="text-xs text-muted-foreground"
				>{stat[1]}</span
			>
		</article>
	{/each}
</section>
<div
	class="skill-controls schedule-controls mt-4 grid max-w-3xl grid-cols-[minmax(220px,2fr)_repeat(2,minmax(130px,1fr))] gap-2 max-[700px]:grid-cols-2"
>
	<Input
		bind:value={filter}
		class="inventory-filter max-[700px]:col-span-full"
		placeholder="Filter scheduled jobs"
		aria-label="Filter scheduled jobs"
	/>
	<select class={inputClass} bind:value={status} aria-label="Filter schedules by status">
		<option value="all">All statuses</option>
		{#each jobStatuses() as option}<option value={option}>{label(option)}</option>{/each}
	</select>
	<select class={inputClass} bind:value={scheduleGroup} aria-label="Group schedules">
		<option value="none">No grouping</option>
		<option value="status">Group by status</option>
	</select>
</div>
<p class="skill-result-count my-3 text-xs text-muted-foreground">
	{filteredJobs().length} of {jobs.length} jobs
</p>
<div class="skill-groups grid gap-2.5">
	{#each jobGroups() as item}
		<section class="skill-group grid gap-2.5">
			{#if item.name}
				<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{item.name}
				</h2>
			{/if}
			<div class="inventory-list grid gap-2">
				{#each item.jobs as job}
					<article class={`${card} flex flex-wrap items-center justify-between gap-4`}>
						<div class="grid gap-1">
							<strong>{job.name || job.id}</strong>
							<small class="text-muted-foreground">{job.cron}</small>
							{#if job.nextRun}
								<small class="schedule-runs text-xs text-muted-foreground">Next {job.nextRun}</small
								>
							{/if}
							<a
								class="text-xs text-primary underline"
								href={`/?project=none&collection=cron&session=${encodeURIComponent(job.sessionId)}`}
								>Review Session</a
							>
						</div>
						<div class="ml-auto flex flex-wrap items-center gap-2">
							<span
								class={`rounded-full px-2 py-1 text-xs ${job.status === 'active' ? 'bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]' : 'bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-[var(--warning)]'}`}
								>{job.status}</span
							>
							<Button
								size="sm"
								variant="outline"
								onclick={() => onaction('schedule.run', { id: job.id, runId: crypto.randomUUID() })}
								>Run now</Button
							>
							<Button size="sm" variant="outline" onclick={() => loadHistory(job)}
								>Run history</Button
							>
							<Button
								size="sm"
								variant="outline"
								onclick={() =>
									onaction(job.status === 'active' ? 'schedule.pause' : 'schedule.resume', {
										id: job.id
									})}>{job.status === 'active' ? 'Pause' : 'Resume'}</Button
							>
							<Button size="sm" variant="outline" onclick={() => editJob(job)}>Edit</Button>
							<Button
								size="sm"
								variant="destructive"
								onclick={() => onaction('schedule.delete', { id: job.id })}>Delete</Button
							>
						</div>
					</article>
					{#if historyJob === job.id}
						<aside class={card} aria-label={`${job.name ?? job.id} run history`}>
							<strong>Run history, output, and errors</strong>
							{#if historyError}<p class="mt-2 text-sm text-destructive" role="alert">
									{historyError}
								</p>{:else if history}<pre
									class="mt-2 max-h-80 overflow-auto text-xs">{JSON.stringify(
										history,
										null,
										2
									)}</pre>{:else}<p class="mt-2 text-sm text-muted-foreground">
									Loading history…
								</p>{/if}
						</aside>
					{/if}
				{/each}
			</div>
		</section>
	{/each}
	{#if !filteredJobs().length}
		<p class="muted text-muted-foreground">No jobs match these filters.</p>
	{/if}
</div>
