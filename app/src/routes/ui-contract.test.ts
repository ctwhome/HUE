import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('./+page.svelte');
const workspace = read('../lib/components/Workspace.svelte');
const workspacePaths = [
	'../lib/components/Workspace.svelte',
	'../lib/components/workspace/Composer.svelte',
	'../lib/components/workspace/ContextPanel.svelte',
	'../lib/components/workspace/Conversation.svelte',
	'../lib/components/workspace/ProjectRail.svelte',
	'../lib/components/workspace/message-state.svelte.ts',
	'../lib/components/workspace/navigation.svelte.ts',
	'../lib/components/workspace/project-management.svelte.ts',
	'../lib/components/workspace/runtime-state.svelte.ts',
	'../lib/components/workspace/session-state.svelte.ts',
	'../lib/components/workspace/transcript-follow.svelte.ts'
];
const workspaceFiles = workspacePaths.map(read);
const page = `${route}\n${workspaceFiles.join('\n')}`;
const layout = read('./+layout.svelte');
const appStyles = read('../app.css');
const styleFiles = [
	'../styles/theme-base.css',
	'../styles/workspace-forms.css',
	'../styles/conversation-composer.css',
	'../styles/responsive.css'
].map(read);
const styles = [appStyles, ...styleFiles].join('\n');
const navigation = read('../lib/components/GlobalNavigation.svelte');
const panel = read('../lib/components/HermesPanel.svelte');
const voiceCall = read('../lib/voice/voice-call.svelte.ts');
const hermesViews = [
	'AdminResourceView',
	'InventoryView',
	'PreferencesView',
	'RuntimeView',
	'SchedulesView',
	'SettingsView',
	'SkillsView'
].map((name) => read(`../lib/components/hermes/${name}.svelte`));
const hermes = [panel, ...hermesViews].join('\n');
const workbenchFiles = [
	'../lib/components/ProjectWorkbench.svelte',
	'../lib/components/workbench/BrowserPanel.svelte',
	'../lib/components/workbench/HealthStrip.svelte',
	'../lib/components/workbench/TerminalPanel.svelte',
	'../lib/components/workbench/RepositoryPanels.svelte',
	'../lib/components/workbench/api.ts'
].map(read);
const workbench = workbenchFiles.join('\n');
const button = read('../lib/components/ui/Button.svelte');
const input = read('../lib/components/ui/Input.svelte');
const textarea = read('../lib/components/ui/Textarea.svelte');
const ui = [page, navigation, panel, workbench].join('\n');
const e2e = read('./workspace.e2e.ts');

test('uses Tailwind tokens and local shadcn-style primitives', () => {
	expect(appStyles).toContain("@import 'tailwindcss'");
	expect(styles).toContain('@theme inline');
	expect(styles).toContain('--color-background: var(--background)');
	expect(button).toContain(
		"type Variant = 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive'"
	);
	expect(input).toContain('focus-visible:ring-2 focus-visible:ring-ring');
	expect(textarea).toContain('focus-visible:ring-2 focus-visible:ring-ring');
	expect(appStyles.split('\n').length).toBeLessThan(20);
	for (const source of styleFiles) expect(source.split('\n').length).toBeLessThan(501);
});

test('keeps major workspace surfaces in focused Svelte components', () => {
	for (const component of ['GlobalNavigation', 'HermesPanel', 'ProjectWorkbench']) {
		expect(workspace).toContain(`<${component}`);
	}
	expect(route.split('\n').length).toBeLessThan(20);
	for (const source of workspaceFiles) expect(source.split('\n').length).toBeLessThan(501);
});

test('workflow fields have accessible names', () => {
	expect(page).toContain('aria-label="Workflow name"');
	expect(page).toContain('aria-label="Workflow prompt"');
});

test('tooltips use the app-level collision-aware provider', () => {
	expect(layout).toContain("import TooltipProvider from '$lib/components/TooltipProvider.svelte'");
	expect(layout).toContain('<TooltipProvider />');
	expect(styles).toMatch(/\.app-tooltip\s*\{[^}]*position: fixed;[^}]*z-index: 100;/s);
	const tooltip = read('../lib/components/TooltipProvider.svelte');
	expect(tooltip).toContain("trigger.closest('.global-rail')");
	expect(tooltip).toContain('target.right + gap');
});

test('global navigation exposes workspace and Hermes administration', () => {
	expect(navigation).toContain('aria-label="Global navigation"');
	expect(navigation).toContain('href="/docs/"');
	expect(navigation).toContain('aria-label="Open documentation in a new tab"');
	for (const label of [
		'Workspace',
		'Settings',
		'Schedules',
		'Skills',
		'Commands',
		'Profiles',
		'MCP'
	]) {
		expect(navigation).toContain(`aria-label="${label}"`);
	}
	expect(navigation).toContain('aria-label="Inspect Hermes runtime"');
	expect(navigation).toContain('class="global-admin mt-auto');
});

test('Hermes management remains complete and request-race safe', () => {
	for (const section of [
		'Runtime',
		'Memory',
		'Skills',
		'Schedules',
		'Commands',
		'Profiles',
		'MCP',
		'Models'
	]) {
		expect(hermes).toContain(`label: '${section}'`);
	}
	expect(hermes).toContain('requestGeneration');
	expect(hermes).toContain('request !== requestGeneration');
	expect(hermes).toContain('aria-label="Skill content"');
	expect(hermes).toContain('confirmDestructive');
	expect(hermes).toContain('runtime.restart-admin');
	expect(hermes).toContain('runtime.reconnect-acp');
	expect(hermes).toContain('oncommand');
	for (const action of ['Create schedule', 'Run now', 'Run history', 'Pause', 'Resume', 'Delete']) {
		expect(hermes).toContain(action);
	}
	expect(hermes).toContain("window.prompt('Schedule prompt', job.prompt ?? '')");
	expect(hermes).toContain("window.prompt('Cron schedule', job.schedule ?? '')");
	expect(hermes).toContain("window.prompt('Delivery target', job.deliver ?? 'local')");
	for (const capability of ['memoryEditor', 'memoryHistory', 'skillDelete', 'skillLinkedFiles']) {
		expect(hermes).toContain(capability);
	}
	expect(hermes).toContain('beforeunload');
	expect(hermes).not.toContain('notice = `Verified ${target || action}`');
	for (const outcome of [
		'Confirmation required',
		'Health or authentication failed',
		'Could not verify absence',
		'Reconciliation required',
		'Unsupported'
	]) {
		expect(hermes).toContain(outcome);
	}
	expect(hermes).toContain('Next-launch default');
	expect(hermes).toContain('Running admin profile');
	expect(hermes).toContain('Running ACP profile');
	expect(hermes).toContain('Use next launch');
	expect(hermes).toContain('Nous provider/bootstrap session');
	expect(hermes).toContain('Dashboard auth gate');
	expect(hermes).toContain('Gateway state');
	expect(hermes).toContain('Open authorization');
	expect(hermes).toContain('Check authorization status');
	expect(hermes).toContain('Cancel authorization');
	expect(hermes).toContain('Read-only');
	expect(hermes).toContain('profile: job.profile');
});

test('preferences expose supported appearance, input, language, voice, usage, and CLI controls', () => {
	const preferences = read('../lib/components/hermes/PreferencesView.svelte');
	for (const label of [
		'Send key',
		'Theme',
		'Density',
		'Language',
		'Voice',
		'Show usage',
		'Show CLI Sessions'
	]) {
		expect(preferences).toContain(label);
	}
	expect(preferences).toContain('hue:preferences');
	expect(preferences).toContain('disabled');
	expect(preferences).toContain('Unsupported: Hermes session origin/source metadata unavailable');
	expect(preferences).not.toContain('bind:checked={showCliSessions}');
	expect(voiceCall).toContain("dataset.voice === 'system'");
	expect(voiceCall).toContain('SpeechSynthesisUtterance');
});

test('project workbench owns browser, terminal, and Git behavior', () => {
	for (const source of workbenchFiles) expect(source.split('\n').length).toBeLessThan(501);
	for (const label of ['Project browser', 'Project terminal', 'Git status', 'Git worktrees']) {
		expect(workbench).toContain(`aria-label="${label}"`);
	}
	expect(workbench).toContain("import { Terminal } from '@xterm/xterm'");
	expect(workbench).toContain('inputSequence: Math.max(item.inputSequence, body.inputSequence)');
	expect(workbench).toContain("action: 'stage'");
	expect(workbench).toContain("action: 'commit'");
	expect(workbench).toContain("action: 'push'");
	expect(workbench).toContain('onDestroy(() =>');
	expect(styles).toContain("grid-template-areas: 'browser repository' 'terminal worktrees'");
});

test('mobile shell keeps drawers and 44px targets', () => {
	expect(styles).toMatch(/@media \(max-width: 700px\)/);
	expect(styles).toContain('min-height: 44px');
	expect(styles).toContain('.project-rail.open');
	expect(styles).toContain('.context-panel.open');
	expect(styles).toContain('grid-template-columns: repeat(3, 44px) minmax(0, 1fr) 44px');
});

test('project and session controls preserve accessible editing', () => {
	expect(page).toContain('aria-label="Add project"');
	expect(page).toContain('aria-label="New session without a project"');
	expect(page).toContain('aria-label="Project icon image"');
	expect(page).toContain('aria-label="Choose project emoji"');
	expect(page).toContain('aria-label={`Edit ${project.name}`}');
	expect(page).toContain("method: 'PATCH'");
	expect(page).toContain("method: 'DELETE'");
});

test('stale Projects and first run expose direct recovery instead of a broken workbench', () => {
	for (const label of [
		'Locate',
		'Remove',
		'Open without Project',
		'Add Project',
		'Start without Project'
	]) {
		expect(page).toContain(label);
	}
	expect(page).toContain('selectedProject && !selectedProject.rootAvailable');
	expect(page).not.toContain('<span>No PTY</span>');
});

test('workbench reports Project, Git, terminal, preview, ACP, and admin health separately', () => {
	for (const label of ['Project', 'Git', 'Terminal', 'Preview', 'Hermes ACP', 'Hermes admin']) {
		expect(workbench).toContain(label);
	}
	expect(workbench).toContain('/api/health?projectId=');
});

test('composer preserves complete-envelope and unknown-delivery controls', () => {
	expect(page).toContain("'Message Hermes… / for commands'");
	expect(page).toContain('aria-label="Send"');
	expect(page).toContain('onretry={messageState.retryPendingMessage}');
	expect(page).toContain('Retry exact message');
	expect(page).toContain("this.setError(body.transcriptError ?? '');");
	expect(page).toContain('popover="auto"');
	expect(page).toContain('role="menuitemradio"');
});

test('chat remains internally scrollable and exposes message actions', () => {
	expect(page).toContain('h-dvh');
	expect(page).toContain('class="transcript min-h-0 flex-1 overflow-auto');
	expect(page).toContain('aria-label="Scroll to latest message"');
	expect(styles).toContain('white-space: pre-wrap');
	for (const label of [
		'Copy message',
		'Edit and resend message',
		'Fork from this message unavailable'
	]) {
		expect(page).toContain(`aria-label="${label}"`);
	}
	expect(page).toContain(
		'Hermes ACP can duplicate a full Session but cannot fork from a selected message'
	);
	expect(page).toContain('navigator.clipboard.writeText(message.text)');
});

test('interface icons use lucide instead of handwritten SVGs', () => {
	expect(ui).not.toContain('<svg');
	for (const icon of [
		'MessageSquare',
		'CalendarDays',
		'Grid2X2',
		'Code2',
		'UserRound',
		'Plus',
		'X',
		'RefreshCw',
		'Send'
	]) {
		expect(ui).toContain(`<${icon}`);
	}
});

test('e2e fixture contains no personal absolute path', () => {
	expect(e2e).not.toContain('/Users/ctw/');
	expect(e2e).toContain('process.cwd()');
});
