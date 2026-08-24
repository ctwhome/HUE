<script lang="ts">
	import type { Project, Session } from './types';
	let {
		project,
		sessions,
		onresume,
		onsessions,
		ontools
	}: {
		project: Project;
		sessions: Session[];
		onresume: (session: Session) => void;
		onsessions: () => void;
		ontools: () => void;
	} = $props();
</script>

<section
	class="mobile-project-entry mx-auto grid max-w-md flex-1 place-content-center gap-4 p-6 text-center text-muted-foreground"
	aria-label="Choose Session or Project tools"
>
	<h2 class="text-xl text-foreground">{project.name}</h2>
	<p>
		{sessions.length
			? 'Continue with a recent Session, or open Project tools.'
			: 'No Sessions yet. Start one, or open Project tools.'}
	</p>
	<div class="grid gap-2">
		{#if sessions[0]}<button
				class="min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
				onclick={() => onresume(sessions[0])}>Resume {sessions[0].title || 'recent Session'}</button
			>{/if}
		<button class="min-h-11 rounded-md border border-border px-4" onclick={onsessions}
			>{sessions.length ? 'Choose Session' : 'Create Session'}</button
		>
		<button class="min-h-11 rounded-md border border-border px-4" onclick={ontools}
			>Open Project tools</button
		>
	</div>
</section>
