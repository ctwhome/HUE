<script lang="ts">
	import Input from '../ui/Input.svelte';
	import type { Job } from './types';

	let { jobs }: { jobs: Job[] } = $props();
	let filter = $state('');
	let status = $state('all');
	let scheduleGroup = $state<'none' | 'status'>('none');
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
</script>

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
					<article class={`${card} flex items-center justify-between gap-4`}>
						<div class="grid gap-1">
							<strong>{job.name || job.id}</strong>
							<small class="text-muted-foreground">{job.schedule || 'No schedule'}</small>
							{#if job.nextRun || job.lastRun}
								<small class="schedule-runs text-xs text-muted-foreground"
									>{job.nextRun ? `Next ${job.nextRun}` : ''}{job.nextRun && job.lastRun
										? ' · '
										: ''}{job.lastRun ? `Last ${job.lastRun}` : ''}</small
								>
							{/if}
						</div>
						<span
							class={`rounded-full px-2 py-1 text-xs ${job.status === 'active' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}
							>{job.status}</span
						>
					</article>
				{/each}
			</div>
		</section>
	{/each}
	{#if !filteredJobs().length}
		<p class="muted text-muted-foreground">No jobs match these filters.</p>
	{/if}
</div>
