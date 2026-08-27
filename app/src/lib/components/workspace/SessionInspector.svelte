<script lang="ts">
	import X from '~icons/lucide/x';
	import { sessionInspectorRows } from './session-inspector';
	import type { HermesRuntime, Project, Session } from './types';

	let {
		project,
		session,
		runtime,
		delivery,
		pendingInteraction,
		contextPercent
	}: {
		project: Project | null;
		session: Session;
		runtime: HermesRuntime;
		delivery: string;
		pendingInteraction?: string;
		contextPercent: number | null;
	} = $props();
	let dialog: HTMLDialogElement;
	let rows = $derived(
		sessionInspectorRows({
			project: project ? { name: project.name } : null,
			session,
			runtime,
			delivery,
			pendingInteraction
		})
	);
</script>

<button
	type="button"
	class="session-inspector-trigger session-context-ring context-usage"
	style={`--context-percent: ${contextPercent ?? 0}`}
	aria-label={contextPercent === null
		? 'Inspect Session context'
		: `Inspect Session context, ${contextPercent}% used`}
	title={contextPercent === null
		? 'Inspect Session context'
		: `${runtime.usage!.used.toLocaleString()} of ${runtime.usage!.size.toLocaleString()} context tokens used`}
	onclick={() => dialog.showModal()}>{contextPercent === null ? '--' : `${contextPercent}%`}</button
>
<dialog
	bind:this={dialog}
	class="session-inspector"
	aria-labelledby="session-inspector-title"
	onclick={(event) => event.target === dialog && dialog.close()}
>
	<header>
		<div>
			<p>Current context</p>
			<h2 id="session-inspector-title">Session inspector</h2>
		</div>
		<button
			type="button"
			aria-label="Close Session inspector"
			title="Close"
			onclick={() => dialog.close()}><X width={20} height={20} aria-hidden="true" /></button
		>
	</header>
	{#if rows.length}<dl>
			{#each rows as row}<div>
					<dt>{row.label}</dt>
					<dd><svelte:element this={row.code ? 'code' : 'span'}>{row.value}</svelte:element></dd>
				</div>{/each}
		</dl>{:else}<p class="session-inspector-empty">No additional context is available.</p>{/if}
</dialog>
