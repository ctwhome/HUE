<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import Circle from '~icons/lucide/circle';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import Button from '../ui/Button.svelte';
	import { api } from './api';

	type TerminalTab = {
		id: string;
		label: string;
		terminalId: string;
		cursor: number;
		inputSequence: number;
		status: 'starting' | 'running' | 'exited';
	};

	let { projectId }: { projectId: string } = $props();
	let terminalTabs = $state<TerminalTab[]>([]);
	let activeTerminalTabId = $state('');
	let terminalError = $state('');
	let terminalElement = $state<HTMLDivElement>();
	let terminalRenderer: Terminal | null = null;
	let terminalFit: FitAddon | null = null;
	let terminalResizeObserver: ResizeObserver | null = null;
	let terminalPollTimer: ReturnType<typeof setTimeout> | null = null;
	let terminalThemeObserver: MutationObserver | null = null;
	let terminalThemeMedia: MediaQueryList | null = null;
	let terminalInputFlight = Promise.resolve();
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	function activeTerminalTab() {
		return terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? terminalTabs[0];
	}
	function terminalTheme() {
		const styles = getComputedStyle(document.documentElement);
		return {
			background: styles.getPropertyValue('--terminal-background').trim(),
			foreground: styles.getPropertyValue('--terminal-foreground').trim(),
			cursor: styles.getPropertyValue('--terminal-cursor').trim()
		};
	}
	function applyTerminalTheme() {
		if (terminalRenderer) terminalRenderer.options.theme = terminalTheme();
	}
	function mountTerminal() {
		if (!terminalElement) return;
		terminalResizeObserver?.disconnect();
		terminalRenderer?.blur();
		if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
		terminalRenderer?.dispose();
		terminalRenderer = new Terminal({
			cursorBlink: true,
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
			fontSize: 13,
			theme: terminalTheme(),
			scrollback: 5_000
		});
		terminalFit = new FitAddon();
		terminalRenderer.loadAddon(terminalFit);
		terminalRenderer.open(terminalElement);
		terminalRenderer.onData(sendTerminalInput);
		terminalRenderer.onResize(({ cols, rows }) => void resizeTerminal(cols, rows));
		terminalResizeObserver = new ResizeObserver(() => {
			try {
				terminalFit?.fit();
			} catch {
				/* panel is changing layouts */
			}
		});
		terminalResizeObserver.observe(terminalElement);
		terminalFit.fit();
		terminalRenderer.focus();
	}
	async function addTerminalTab() {
		if (!terminalElement) return;
		if (!terminalRenderer) mountTerminal();
		terminalError = '';
		try {
			const body = await api<{ terminalId: string; cursor: number; status: 'running' }>(
				`/api/projects/${projectId}/terminal`,
				{
					method: 'POST',
					body: JSON.stringify({
						action: 'create',
						cols: terminalRenderer?.cols ?? 80,
						rows: terminalRenderer?.rows ?? 24
					})
				}
			);
			const tab: TerminalTab = {
				id: crypto.randomUUID(),
				label: `Terminal ${terminalTabs.length + 1}`,
				terminalId: body.terminalId,
				cursor: body.cursor,
				inputSequence: 0,
				status: body.status
			};
			terminalTabs = [...terminalTabs, tab];
			activeTerminalTabId = tab.id;
			terminalRenderer?.reset();
			startTerminalPolling();
		} catch (cause) {
			terminalError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	function chooseTerminalTab(id: string) {
		activeTerminalTabId = id;
		terminalRenderer?.reset();
		terminalTabs = terminalTabs.map((item) => (item.id === id ? { ...item, cursor: 0 } : item));
		startTerminalPolling();
		terminalRenderer?.focus();
	}
	function closeTerminalTab(event: MouseEvent | KeyboardEvent, tab: TerminalTab) {
		event.stopPropagation();
		terminalTabs = terminalTabs.filter((item) => item.id !== tab.id);
		if (activeTerminalTabId === tab.id) {
			activeTerminalTabId = terminalTabs[0]?.id ?? '';
			terminalRenderer?.reset();
		}
		void api(`/api/projects/${projectId}/terminal`, {
			method: 'POST',
			body: JSON.stringify({ action: 'close', terminalId: tab.terminalId })
		}).catch(() => undefined);
		if (!terminalTabs.length) void addTerminalTab();
		else startTerminalPolling();
	}
	function sendTerminalInput(data: string) {
		const tab = activeTerminalTab();
		if (!tab) return;
		terminalInputFlight = terminalInputFlight
			.then(async () => {
				const current = terminalTabs.find((item) => item.id === tab.id);
				if (!current || current.status !== 'running') return;
				const sequence = current.inputSequence + 1;
				const send = () =>
					api(`/api/projects/${projectId}/terminal`, {
						method: 'POST',
						body: JSON.stringify({
							action: 'input',
							terminalId: current.terminalId,
							sequence,
							data
						})
					});
				try {
					await send();
				} catch {
					try {
						await send();
					} catch {
						const state = await api<{ inputSequence: number }>(
							`/api/projects/${projectId}/terminal?terminalId=${encodeURIComponent(current.terminalId)}&after=0`
						);
						if (state.inputSequence < sequence) await send();
					}
				}
				terminalTabs = terminalTabs.map((item) =>
					item.id === tab.id ? { ...item, inputSequence: sequence } : item
				);
			})
			.catch((cause) => {
				terminalTabs = terminalTabs.map((item) =>
					item.id === tab.id ? { ...item, status: 'exited' } : item
				);
				terminalError = cause instanceof Error ? cause.message : String(cause);
			});
	}
	async function resizeTerminal(cols: number, rows: number) {
		const tab = activeTerminalTab();
		if (tab)
			await api(`/api/projects/${projectId}/terminal`, {
				method: 'POST',
				body: JSON.stringify({ action: 'resize', terminalId: tab.terminalId, cols, rows })
			}).catch(() => undefined);
	}
	function startTerminalPolling() {
		if (terminalPollTimer) clearTimeout(terminalPollTimer);
		void pollTerminal();
	}
	async function pollTerminal() {
		const tab = activeTerminalTab();
		if (!tab) return;
		try {
			const body = await api<{
				output: string;
				cursor: number;
				inputSequence: number;
				reset: boolean;
				status: 'running' | 'exited';
			}>(
				`/api/projects/${projectId}/terminal?terminalId=${encodeURIComponent(tab.terminalId)}&after=${tab.cursor}`
			);
			if (activeTerminalTabId !== tab.id) return;
			if (body.reset) terminalRenderer?.reset();
			if (body.output) terminalRenderer?.write(body.output);
			terminalTabs = terminalTabs.map((item) =>
				item.id === tab.id
					? {
							...item,
							cursor: body.cursor,
							inputSequence: Math.max(item.inputSequence, body.inputSequence),
							status: body.status
						}
					: item
			);
			terminalPollTimer = setTimeout(pollTerminal, body.output ? 30 : 120);
		} catch (cause) {
			if (activeTerminalTabId === tab.id) {
				terminalError = cause instanceof Error ? cause.message : String(cause);
				terminalPollTimer = setTimeout(pollTerminal, 1_000);
			}
		}
	}
	async function closeTerminals() {
		if (terminalPollTimer) clearTimeout(terminalPollTimer);
		terminalResizeObserver?.disconnect();
		terminalThemeObserver?.disconnect();
		terminalThemeMedia?.removeEventListener('change', applyTerminalTheme);
		terminalRenderer?.blur();
		if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
		terminalRenderer?.dispose();
		terminalRenderer = null;
		terminalFit = null;
		const tabs = [...terminalTabs];
		await Promise.all(
			tabs.map((tab) =>
				fetch(`/api/projects/${projectId}/terminal`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'close', terminalId: tab.terminalId }),
					keepalive: true
				}).catch(() => undefined)
			)
		);
	}

	onMount(() => {
		terminalThemeObserver = new MutationObserver(applyTerminalTheme);
		terminalThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
		terminalThemeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
		terminalThemeMedia.addEventListener('change', applyTerminalTheme);
		void addTerminalTab();
	});
	onDestroy(() => void closeTerminals());
</script>

<article class={`${panel} terminal-panel relative`} aria-label="Project terminal">
	<header
		class="terminal-header flex min-h-11 items-center border-b border-border bg-muted/40 pr-2"
	>
		<div
			class="terminal-tabs flex min-w-0 flex-1 self-stretch overflow-x-auto"
			role="tablist"
			aria-label="Terminal tabs"
		>
			{#each terminalTabs as tab}<div
					class="terminal-tab flex min-w-28 items-center border-r border-border text-xs text-muted-foreground"
					class:active={tab.id === activeTerminalTabId}
				>
					<button
						class="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5"
						role="tab"
						aria-selected={tab.id === activeTerminalTabId}
						title={`Open ${tab.label}`}
						onclick={() => chooseTerminalTab(tab.id)}
						><span class="min-w-0 flex-1 overflow-hidden text-left text-ellipsis whitespace-nowrap"
							>{tab.label}</span
						><Circle
							width={7}
							height={7}
							fill="currentColor"
							class={tab.status === 'exited' ? 'exited' : 'text-emerald-400'}
							aria-hidden="true"
						/></button
					>
					<button
						class="grid h-full w-8 place-items-center"
						aria-label={`Close ${tab.label}`}
						title={`Close ${tab.label}`}
						onclick={(event) => closeTerminalTab(event, tab)}
						><X width={12} height={12} aria-hidden="true" /></button
					>
				</div>{/each}
		</div>
		<Button
			variant="outline"
			size="icon"
			class="size-8"
			title="New terminal"
			aria-label="New terminal"
			onclick={addTerminalTab}><Plus width={16} height={16} aria-hidden="true" /></Button
		>
	</header>
	<div
		class="terminal-screen min-h-0 flex-1 bg-[var(--terminal-background)] p-2"
		bind:this={terminalElement}
		role="application"
		aria-label="Interactive project terminal"
	></div>
	{#if terminalError}<p
			class="panel-error terminal-error absolute right-2 bottom-2 rounded-md bg-destructive/20 p-2 text-xs text-destructive"
			role="alert"
		>
			{terminalError}
		</p>{/if}
</article>
