<script lang="ts">
	import Input from '../ui/Input.svelte';
	import Button from '../ui/Button.svelte';
	import type { Job } from './types';

	let {
		jobs,
		deliveryTargets,
		onaction
	}: {
		jobs: Job[];
		deliveryTargets: Array<{ id: string; name: string; home_target_set?: boolean }>;
		onaction: (action: string, input: Record<string, unknown>) => Promise<unknown>;
	} = $props();
	let filter = $state('');
	let status = $state('all');
	let scheduleGroup = $state<'none' | 'status'>('none');
	let newName = $state('');
	let newPrompt = $state('');
	let newSchedule = $state('0 9 * * *');
	let newDeliver = $state('local');
	let newProfile = $state('default');
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
					`${job.name || job.id} ${job.schedule || ''} ${job.status} ${job.nextRun || ''} ${job.lastRun || ''}`
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
		historyJob = `${job.profile}:${job.id}`;
		history = null;
		historyError = '';
		try {
			const response = await fetch(
				`/api/hermes/admin?view=schedules&detail=schedule&id=${encodeURIComponent(job.id)}&profile=${encodeURIComponent(job.profile)}`
			);
			const result = (await response.json()) as Record<string, unknown> & { error?: string };
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
		const schedule = window.prompt('Cron schedule', job.schedule ?? '');
		if (schedule === null) return;
		const deliver = window.prompt('Delivery target', job.deliver ?? 'local');
		if (deliver === null) return;
		void onaction('schedule.update', {
			id: job.id,
			profile: job.profile,
			updates: { name, prompt: promptText, schedule, deliver }
		});
	}
</script>

<form
	class="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-4 max-[700px]:grid-cols-1"
	onsubmit={(event) => {
		event.preventDefault();
		void onaction('schedule.create', {
			profile: newProfile,
			name: newName,
			prompt: newPrompt,
			schedule: newSchedule,
			deliver: newDeliver
		});
	}}
>
	<Input bind:value={newName} aria-label="Schedule name" placeholder="Schedule name" required />
	<Input
		bind:value={newProfile}
		aria-label="Schedule profile"
		placeholder="Exact profile"
		required
	/>
	<Input bind:value={newSchedule} aria-label="Cron schedule" placeholder="0 9 * * *" required />
	<Input
		bind:value={newPrompt}
		class="max-[700px]:col-span-1"
		aria-label="Schedule prompt"
		placeholder="Prompt"
		required
	/>
	<select class={inputClass} bind:value={newDeliver} aria-label="Delivery target">
		{#each deliveryTargets as target}<option
				value={target.id}
				disabled={target.home_target_set === false}>{target.name}</option
			>{/each}
	</select>
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
							<small class="text-muted-foreground"
								>{job.profile} · {job.schedule || 'No schedule'}</small
							>
							{#if job.nextRun || job.lastRun}
								<small class="schedule-runs text-xs text-muted-foreground"
									>{job.nextRun ? `Next ${job.nextRun}` : ''}{job.nextRun && job.lastRun
										? ' · '
										: ''}{job.lastRun ? `Last ${job.lastRun}` : ''}</small
								>
							{/if}
							{#if job.last_status || job.last_error || job.last_delivery_error}
								<small class="text-xs text-muted-foreground"
									>Last {job.last_status ?? 'run'}{job.last_error
										? ` · ${job.last_error}`
										: ''}{job.last_delivery_error
										? ` · Delivery: ${job.last_delivery_error}`
										: ''}</small
								>
							{/if}
						</div>
						<div class="ml-auto flex flex-wrap items-center gap-2">
							<span
								class={`rounded-full px-2 py-1 text-xs ${job.status === 'active' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}
								>{job.status}</span
							>
							<Button
								size="sm"
								variant="outline"
								onclick={() => onaction('schedule.run', { id: job.id, profile: job.profile })}
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
										id: job.id,
										profile: job.profile
									})}>{job.status === 'active' ? 'Pause' : 'Resume'}</Button
							>
							<Button size="sm" variant="outline" onclick={() => editJob(job)}>Edit</Button>
							<Button
								size="sm"
								variant="destructive"
								onclick={() => onaction('schedule.delete', { id: job.id, profile: job.profile })}
								>Delete</Button
							>
						</div>
					</article>
					{#if historyJob === `${job.profile}:${job.id}`}
						<aside class={card} aria-label={`${job.name ?? job.id} run history`}>
							<strong>Run history, output, errors, and delivery</strong>
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
