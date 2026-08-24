<script lang="ts">
	let {
		projectCount,
		projectsCapability,
		projectsError,
		onadd,
		onprojectless
	}: {
		projectCount: number;
		projectsCapability: 'available' | 'unavailable' | 'outage';
		projectsError: string;
		onadd: () => void;
		onprojectless: () => void;
	} = $props();
</script>

<section class="hero mx-auto mt-[12vh] max-w-2xl p-8 text-center text-muted-foreground">
	<div
		class="hero-mark mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-gradient-to-br from-violet-300 to-violet-700 font-black text-violet-950 shadow-lg"
	>
		H
	</div>
	<h2>{projectCount ? 'Projects · Workflows · Sessions' : 'Start your first HUE workspace'}</h2>
	<p>
		{projectCount
			? 'Choose a Project, or continue without one for a general Hermes Session.'
			: 'Add a trusted local folder for project work, or start a private projectless Session.'}
	</p>
	<div class="mt-5 flex flex-wrap justify-center gap-2">
		<button
			class="min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
			disabled={projectsCapability !== 'available'}
			title={projectsCapability === 'available' ? 'Add Project' : projectsError}
			onclick={onadd}>Add Project</button
		>
		<button class="min-h-11 rounded-md border border-border px-4" onclick={onprojectless}
			>Start without Project</button
		>
	</div>
	<div class="principles mt-6 flex flex-wrap justify-center gap-2">
		<span>Local SQLite</span><span>ACP v1</span><span>Project terminals</span><span
			>Reconnect cursors</span
		>
	</div>
</section>
