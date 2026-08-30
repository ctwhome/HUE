<script lang="ts">
	import { onMount } from 'svelte';
	import {
		applyPreferences,
		defaultPreferences,
		normalizePreferences,
		readPreferences,
		type HUEPreferences
	} from '$lib/preferences';
	import ChatBackgroundPicker from '../workspace/ChatBackgroundPicker.svelte';
	import {
		CHAT_BACKGROUND_EVENT,
		readGeneralChatBackground,
		resizeChatBackground,
		writeGeneralChatBackground,
		type ChatBackground
	} from '../workspace/chat-background';

	let sendKey = $state<HUEPreferences['sendKey']>(defaultPreferences.sendKey);
	let theme = $state<HUEPreferences['theme']>(defaultPreferences.theme);
	let density = $state<HUEPreferences['density']>(defaultPreferences.density);
	let chatFontSize = $state(defaultPreferences.chatFontSize);
	let limitChatWidth = $state(defaultPreferences.limitChatWidth);
	let language = $state(defaultPreferences.language);
	let voice = $state(defaultPreferences.voice);
	let showUsage = $state(defaultPreferences.showUsage);
	let hiddenFilePatterns = $state(defaultPreferences.hiddenFilePatterns);
	let chatBackground = $state<ChatBackground | null>(null);
	let backgroundError = $state('');
	let ready = $state(false);
	const selectClass = 'min-h-11 rounded-md border border-input bg-background px-3 text-sm';

	function apply() {
		if (!ready) return;
		const preferences = normalizePreferences({
			sendKey,
			theme,
			density,
			chatFontSize,
			limitChatWidth,
			language,
			voice,
			showUsage,
			hiddenFilePatterns
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
		chatFontSize = preferences.chatFontSize;
		limitChatWidth = preferences.limitChatWidth;
		language = preferences.language;
		voice = preferences.voice;
		showUsage = preferences.showUsage;
		hiddenFilePatterns = preferences.hiddenFilePatterns;
		chatBackground = readGeneralChatBackground(localStorage);
		ready = true;
		apply();
	});

	function setChatBackground(background: ChatBackground | null) {
		try {
			writeGeneralChatBackground(localStorage, background?.kind === 'none' ? null : background);
			chatBackground = background?.kind === 'none' ? null : background;
			backgroundError = '';
			window.dispatchEvent(new CustomEvent(CHAT_BACKGROUND_EVENT));
		} catch {
			backgroundError = 'Could not save the background in this browser';
		}
	}

	async function uploadChatBackground(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			setChatBackground({ kind: 'custom', image: await resizeChatBackground(file) });
		} catch (cause) {
			backgroundError = cause instanceof Error ? cause.message : String(cause);
		}
	}
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
		<div class="grid gap-1 text-sm">
			<label class="flex justify-between" for="chat-font-size"
				>Chat font size <output>{chatFontSize} px</output></label
			><input
				id="chat-font-size"
				class="min-h-11 accent-primary"
				type="range"
				min="12"
				max="20"
				step="1"
				bind:value={chatFontSize}
				oninput={apply}
			/>
		</div>
		<label class="flex min-h-11 items-center gap-2 text-sm"
			><input type="checkbox" bind:checked={limitChatWidth} onchange={apply} /> Limit chat width</label
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
		<label class="col-span-2 grid gap-1 text-sm max-[700px]:col-span-1"
			>Hidden file patterns<textarea
				class="min-h-32 resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
				aria-label="Hidden file patterns"
				placeholder={'.DS_Store\n*.log\nnode_modules'}
				maxlength="10000"
				bind:value={hiddenFilePatterns}
				oninput={apply}></textarea><small class="text-muted-foreground"
				>One exact name or * / ? pattern per line. Folder matches also hide their contents.</small
			></label
		>
	</div>
	<fieldset class="grid gap-2 border-t border-border pt-3">
		<legend class="text-sm font-medium">Default chat background</legend>
		<ChatBackgroundPicker
			value={chatBackground}
			onselect={setChatBackground}
			onupload={uploadChatBackground}
		/>
		<p class="text-xs text-muted-foreground">
			New and existing Sessions use this unless they have their own background.
		</p>
		{#if backgroundError}<p class="text-sm text-destructive" role="alert">{backgroundError}</p>{/if}
	</fieldset>
	<p class="text-xs text-muted-foreground">
		Unsupported: Hermes session origin/source metadata unavailable; CLI Sessions cannot be filtered
		authoritatively.
	</p>
</section>
