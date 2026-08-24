<script lang="ts">
	import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-svelte';
	import type { WorkspaceTimelineItem } from '$lib';

	let {
		items,
		renderMarkdown,
		busy
	}: {
		items: WorkspaceTimelineItem[];
		renderMarkdown: (text: string) => string;
		busy: boolean;
	} = $props();
	let open = $state(false);

	const serialized = (value: unknown) =>
		typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	const validTimestamp = (value?: string): value is string =>
		!!value && !Number.isNaN(Date.parse(value));
	const timestamp = (value: string) =>
		new Date(value).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		});
	const timestampTitle = (value: string) =>
		new Date(value).toLocaleString([], { dateStyle: 'full', timeStyle: 'long' });
	const activityTitle = (item: WorkspaceTimelineItem) => {
		if (item.kind === 'thought') return 'Reasoning';
		if (item.kind === 'status') return 'Status';
		if (item.kind === 'tool') return item.title ?? item.name ?? 'Tool call';
		if (item.kind === 'permission') return 'Permission';
		if (item.kind === 'clarify') return 'Clarification';
		return item.kind === 'subagents' ? (item.title ?? 'Subagents') : 'Activity';
	};

</script>

{#if busy}<section class="thinking-activity" aria-label="Thinking activity">
		<button
			type="button"
			class="thinking-trigger"
			aria-controls="thinking-activity-panel"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<LoaderCircle class="animate-spin" size={16} aria-hidden="true" />
			<span>Thinking</span><small>In progress</small>
			<ChevronDown class={open ? 'expanded' : ''} size={16} aria-hidden="true" />
		</button>
		{#if open}<div id="thinking-activity-panel" class="thinking-panel">
			<div class="thinking-timeline" aria-label="Thinking timeline">
				{#each items as item (item.kind + ':' + item.sequence)}<article
						class="thinking-event"
						data-thinking-sequence={item.sequence}
					>
						<div class="thinking-event-meta">
							<strong>{activityTitle(item)}</strong>
							{#if validTimestamp(item.createdAt)}<time
									datetime={item.createdAt}
									title={timestampTitle(item.createdAt)}
									aria-label={timestampTitle(item.createdAt)}>{timestamp(item.createdAt)}</time
								>{:else}<span>Time unavailable</span>{/if}
						</div>
						{#if item.kind === 'thought'}<div class="markdown">
								{@html renderMarkdown(item.text)}
							</div>{:else if item.kind === 'status'}<p>
								{item.label}
							</p>{:else if item.kind === 'tool'}<details
								class="activity-card"
								aria-label={item.title ?? item.name ?? 'Tool call'}
							>
								<summary
									><ChevronRight size={14} aria-hidden="true" /><span
										>{item.status.replace('_', ' ')}</span
									>{#if item.durationMs !== undefined}<span>{item.durationMs} ms</span
										>{/if}</summary
								>
								<div class="activity-body">
									{#if item.name}<p>Tool: {item.name}</p>{/if}
									{#if item.args !== undefined}<strong>Arguments</strong>
										<pre>{serialized(item.args)}</pre>{/if}
									{#if item.result !== undefined}<strong>Result</strong>
										<pre>{serialized(item.result)}</pre>{/if}
									{#if item.error}<p class="text-destructive" role="alert">{item.error}</p>{/if}
								</div>
							</details>{:else if item.kind === 'permission'}<div class="interaction-history">
								<strong>{item.toolCall?.title ?? 'Hermes permission request'}</strong>
								<p>Status: {item.status.replace('_', ' ')}</p>
								{#if item.toolCall?.args !== undefined}<pre>{serialized(
											item.toolCall.args
										)}</pre>{/if}
							</div>{:else if item.kind === 'clarify'}<div class="interaction-history">
								<strong>{item.message ?? 'Hermes clarification'}</strong>
								<p>Status: {item.status.replace('_', ' ')}</p>
								{#if item.fields?.length}<p>
										{item.fields.map(({ label }) => label).join(' · ')}
									</p>{/if}
							</div>{:else if item.kind === 'subagents'}<div class="subagent-children">
								<p class="activity-status">{item.status.replace('_', ' ')}</p>
								{#each item.children ?? [] as child (child.index)}<section class="subagent-detail">
										<header>
											<strong>{child.goal}</strong><span>{child.status.replace('_', ' ')}</span>
										</header>
										{#if child.role}<p>Role: {child.role}</p>{/if}
										{#if child.result}<pre>{child.result}</pre>{/if}
									</section>{/each}
							</div>{/if}
					</article>{/each}
			</div>
		</div>{/if}
	</section>{/if}
