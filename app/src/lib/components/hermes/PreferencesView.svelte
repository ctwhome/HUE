<script lang="ts">
	import { onMount } from 'svelte';
	import {
		applyPreferences,
		defaultPreferences,
		normalizePreferences,
		readPreferences,
		type HUEPreferences
	} from '$lib/preferences';

	let sendKey = $state<HUEPreferences['sendKey']>(defaultPreferences.sendKey);
	let theme = $state<HUEPreferences['theme']>(defaultPreferences.theme);
	let density = $state<HUEPreferences['density']>(defaultPreferences.density);
	let language = $state(defaultPreferences.language);
	let voice = $state(defaultPreferences.voice);
	let showUsage = $state(defaultPreferences.showUsage);
	let ready = $state(false);
	const selectClass = 'min-h-11 rounded-md border border-input bg-background px-3 text-sm';

	function apply() {
		if (!ready) return;
		const preferences = normalizePreferences({
			sendKey,
			theme,
			density,
			language,
			voice,
			showUsage
		});
		localStorage.setItem('hue:preferences', JSON.stringify(preferences));
		applyPreferences(document.documentElement, preferences);
		window.dispatchEvent(new CustomEvent('hue:preferences', { detail: preferences }));
	}

	onMount(() => {
		const preferences = readPreferences(localStorage);
		sendKey = preferences.sendKey;
		theme = preferences.theme;
		density = preferences.density;
		language = preferences.language;
		voice = preferences.voice;
		showUsage = preferences.showUsage;
		ready = true;
		apply();
	});
</script>

<section
	class="grid gap-3 rounded-xl border border-border bg-card p-4"
	aria-label="HUE preferences"
>
	<h2 class="font-semibold">Preferences</h2>
	<div class="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
		<label class="grid gap-1 text-sm"
			>Send key<select class={selectClass} bind:value={sendKey} onchange={apply}
				><option value="enter">Enter</option><option value="mod-enter">⌘/Ctrl + Enter</option
				></select
			></label
		>
		<label class="grid gap-1 text-sm"
			>Theme<select class={selectClass} bind:value={theme} onchange={apply}
				><option value="system">System</option><optgroup label="Light themes"
					><option value="light">VS Code Light</option><option value="github-light"
						>GitHub Light</option
					><option value="solarized-light">Solarized Light</option></optgroup
				><optgroup label="Dark themes"
					><option value="dark">VS Code Dark</option><option value="tokyo-night">Tokyo Night</option
					><option value="nord">Nord</option><option value="oled">OLED</option></optgroup
				></select
			></label
		>
		<label class="grid gap-1 text-sm"
			>Density<select class={selectClass} bind:value={density} onchange={apply}
				><option value="comfortable">Comfortable</option><option value="compact">Compact</option
				></select
			></label
		>
		<label class="grid gap-1 text-sm"
			>Language<select class={selectClass} bind:value={language} onchange={apply}
				><option value="en">English</option><option value="nl-NL">Nederlands</option></select
			></label
		>
		<label class="grid gap-1 text-sm"
			>Voice<select class={selectClass} bind:value={voice} onchange={apply}
				><option value="hermes">Hermes configured voice</option><option value="system"
					>System voice</option
				></select
			></label
		>
		<label class="flex min-h-11 items-center gap-2 text-sm"
			><input type="checkbox" bind:checked={showUsage} onchange={apply} /> Show usage</label
		>
		<label class="flex min-h-11 items-center gap-2 text-sm"
			><input type="checkbox" disabled /> Show CLI Sessions</label
		>
	</div>
	<p class="text-xs text-muted-foreground">
		Unsupported: Hermes session origin/source metadata unavailable; CLI Sessions cannot be filtered
		authoritatively.
	</p>
</section>
