<script lang="ts">
	import ArrowLeft from '~icons/lucide/arrow-left';
	import { highlightMarkdown } from '$lib/markdown-highlight';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import Textarea from '../ui/Textarea.svelte';
	import type { Skill } from './types';

	let {
		skills,
		selectedSkill,
		selectedSkillEditable,
		selectedSkillProvenance,
		skillContent = $bindable(),
		skillSaving,
		skillSaved,
		onopen,
		onclose,
		onsave,
		ondelete,
		onaction,
		capabilities
	}: {
		skills: Skill[];
		selectedSkill: string;
		selectedSkillEditable: boolean;
		selectedSkillProvenance: string;
		skillContent: string;
		skillSaving: boolean;
		skillSaved: boolean;
		onopen: (name: string) => void;
		onclose: () => void;
		onsave: () => void;
		ondelete: (name: string) => void;
		onaction: (action: string, input: Record<string, unknown>) => Promise<unknown>;
		capabilities: Record<string, boolean>;
	} = $props();

	let filter = $state('');
	let category = $state('all');
	let source = $state('all');
	let status = $state('all');
	let group = $state<'none' | 'category' | 'source'>('none');
	let highlightElement = $state<HTMLElement>();
	let newSkillName = $state('');
	let newSkillCategory = $state('general');
	const inputClass =
		'h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring max-[700px]:min-h-11';
	const card = 'rounded-xl border border-border bg-card p-4';
	const skillCategory = (skill: Skill) => skill.category || 'Uncategorised';
	const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
	const skillOptions = (key: 'category' | 'source' | 'status') =>
		[
			...new Set(skills.map((skill) => (key === 'category' ? skillCategory(skill) : skill[key])))
		].sort((a, b) => a.localeCompare(b));
	const filteredSkills = () => {
		const query = filter.trim().toLowerCase();
		return skills.filter(
			(skill) =>
				(!query ||
					`${skill.name} ${skillCategory(skill)} ${skill.source} ${skill.status}`
						.toLowerCase()
						.includes(query)) &&
				(category === 'all' || skillCategory(skill) === category) &&
				(source === 'all' || skill.source === source) &&
				(status === 'all' || skill.status === status)
		);
	};
	const skillGroups = () => {
		const items = filteredSkills();
		if (group === 'none') return [{ name: '', skills: items }];
		return [
			...Map.groupBy(items, (skill) =>
				label(group === 'category' ? skillCategory(skill) : skill.source)
			).entries()
		]
			.map(([name, grouped]) => ({ name, skills: grouped }))
			.sort((a, b) => a.name.localeCompare(b.name));
	};
	function syncScroll(event: Event) {
		if (!highlightElement) return;
		const textarea = event.currentTarget as HTMLTextAreaElement;
		highlightElement.scrollTop = textarea.scrollTop;
		highlightElement.scrollLeft = textarea.scrollLeft;
	}
</script>

{#if selectedSkill}
	<div class="skill-editor grid h-full min-h-0 grid-rows-[auto_minmax(420px,1fr)_auto] gap-3.5">
		<div class="skill-editor-heading flex items-center gap-3">
			<Button variant="outline" title="Back to skills" onclick={onclose}
				><ArrowLeft width={15} height={15} aria-hidden="true" /> Back to skills</Button
			>
			<h2 class="font-semibold">{selectedSkill}</h2>
			{#if !selectedSkillEditable}<span class="text-sm text-muted-foreground"
					>Read-only · {selectedSkillProvenance} provenance</span
				>{/if}
		</div>
		<div class="skill-editor-code relative min-h-[420px]">
			<pre
				class="absolute inset-0 m-0 overflow-hidden rounded-md border border-border bg-background p-3 font-mono text-sm leading-relaxed"
				bind:this={highlightElement}
				aria-hidden="true"><code>{@html highlightMarkdown(skillContent)}</code></pre>
			<Textarea
				class="absolute inset-0 h-full resize-none overflow-auto border-border bg-transparent font-mono leading-relaxed text-transparent caret-foreground selection:bg-primary/40"
				bind:value={skillContent}
				aria-label="Skill content"
				spellcheck="false"
				disabled={!selectedSkillEditable}
				onscroll={syncScroll}
			/>
		</div>
		<div class="skill-editor-actions flex items-center justify-end gap-3">
			{#if skillSaved}<span class="text-[var(--success)]" role="status">Saved</span>{/if}
			<Button title="Save skill" onclick={onsave} disabled={skillSaving || !selectedSkillEditable}
				>{skillSaving ? 'Saving…' : 'Save skill'}</Button
			>
		</div>
	</div>
{:else}
	<form
		class="mb-4 grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border border-border bg-card p-4 max-[700px]:grid-cols-1"
		onsubmit={(event) => {
			event.preventDefault();
			void onaction('skill.create', {
				name: newSkillName,
				category: newSkillCategory,
				content: `---\nname: ${newSkillName}\ndescription: Describe this skill\n---\n\n# ${newSkillName}\n`
			});
		}}
	>
		<Input
			bind:value={newSkillName}
			aria-label="New skill name"
			placeholder="New skill name"
			required
		/>
		<Input
			bind:value={newSkillCategory}
			aria-label="New skill category"
			placeholder="Category"
			required
		/>
		<Button type="submit" disabled={!capabilities.create}>Create skill</Button>
	</form>
	<section
		class="skill-statistics grid grid-cols-4 gap-2 max-[700px]:grid-cols-2"
		aria-label="Skill statistics"
	>
		{#each [[skills.length, 'Installed', `${skills.length} installed skills`], [skills.filter((skill) => skill.status === 'enabled').length, 'Enabled', `${skills.filter((skill) => skill.status === 'enabled').length} enabled skills`], [skillOptions('category').length, 'Categories', `${skillOptions('category').length} skill categories`], [skillOptions('source').length, 'Sources', `${skillOptions('source').length} skill sources`]] as stat}
			<article class={`${card} grid gap-0.5`} aria-label={String(stat[2])}>
				<strong class="text-xl">{stat[0]}</strong><span class="text-xs text-muted-foreground"
					>{stat[1]}</span
				>
			</article>
		{/each}
	</section>
	<div
		class="skill-controls mt-4 grid grid-cols-[minmax(220px,2fr)_repeat(4,minmax(110px,1fr))] gap-2 max-[700px]:grid-cols-2"
	>
		<Input
			bind:value={filter}
			class="inventory-filter max-[700px]:col-span-full"
			placeholder="Filter installed skills"
			aria-label="Filter installed skills"
		/>
		<select class={inputClass} bind:value={category} aria-label="Filter skills by category">
			<option value="all">All categories</option>
			{#each skillOptions('category') as option}<option value={option}>{label(option)}</option
				>{/each}
		</select>
		<select class={inputClass} bind:value={source} aria-label="Filter skills by source">
			<option value="all">All sources</option>
			{#each skillOptions('source') as option}<option value={option}>{label(option)}</option>{/each}
		</select>
		<select class={inputClass} bind:value={status} aria-label="Filter skills by status">
			<option value="all">All statuses</option>
			{#each skillOptions('status') as option}<option value={option}>{label(option)}</option>{/each}
		</select>
		<select class={inputClass} bind:value={group} aria-label="Group skills">
			<option value="none">No grouping</option>
			<option value="category">Group by category</option>
			<option value="source">Group by source</option>
		</select>
	</div>
	<p class="skill-result-count my-3 text-xs text-muted-foreground">
		{filteredSkills().length} of {skills.length} skills
	</p>
	<div class="skill-groups grid gap-2.5">
		{#each skillGroups() as item}
			<section class="skill-group grid gap-2.5">
				{#if item.name}
					<h2 class="mt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{item.name}
					</h2>
				{/if}
				<div class="inventory-list grid gap-2">
					{#each item.skills as skill}
						<article
							class={`${card} inventory-row flex min-h-11 items-center justify-between gap-4`}
						>
							<button
								class="min-w-0 flex-1 text-left"
								aria-label={skill.name}
								title={`Open ${skill.name}`}
								onclick={() => onopen(skill.name)}
							>
								<div class="grid gap-1">
									<strong>{skill.name}</strong>
									<small class="text-muted-foreground"
										>{skillCategory(skill)} · {skill.source}</small
									>
								</div>
							</button>
							<Button
								variant="outline"
								size="sm"
								disabled={!capabilities.toggle}
								onclick={() =>
									onaction('skill.toggle', {
										name: skill.name,
										enabled: skill.status !== 'enabled'
									})}>{skill.status === 'enabled' ? 'Disable' : 'Enable'}</Button
							>
							{#if skill.source === 'custom'}<Button
									variant="destructive"
									size="sm"
									disabled={!capabilities.delete}
									onclick={() => ondelete(skill.name)}>Delete</Button
								>{/if}
						</article>
					{/each}
				</div>
			</section>
		{/each}
		{#if !filteredSkills().length}
			<p class="muted text-muted-foreground">No skills match these filters.</p>
		{/if}
	</div>
{/if}
