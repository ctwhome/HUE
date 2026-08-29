import { MobileGestureController } from './mobile-gesture';
import type { MobilePane } from './mobile-navigation';
import { isDrawerHistoryEntry } from './navigation-history';

type Drawer = Exclude<MobilePane, null>;
type Navigation = {
	mobileDrawer: MobilePane;
	selectedSession: unknown;
	setMobileDrawer: (pane: Drawer, mode: 'push') => void;
	closeMobileDrawer: () => void;
	restoreSelection: () => Promise<boolean>;
};

type MobileShellOptions = {
	drawer: (pane: Drawer) => HTMLElement;
	chat: () => HTMLElement;
	navigation: Navigation;
	onMobile: (mobile: boolean) => void;
	onVisual: (active: boolean) => void;
};

export class MobileShellController {
	private query = matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 500px)');
	private returnFocus: Partial<Record<Drawer, HTMLElement>> = {};
	private gesture: MobileGestureController;

	constructor(private options: MobileShellOptions) {
		this.gesture = new MobileGestureController({
			isMobile: () => this.query.matches,
			pane: () => options.navigation.mobileDrawer,
			hasSession: () => Boolean(options.navigation.selectedSession),
			drawer: options.drawer,
			chat: options.chat,
			open: (pane) => this.open(pane),
			onVisual: options.onVisual
		});
	}

	start() {
		this.syncMobile();
		this.query.addEventListener('change', this.syncMobile);
		window.addEventListener('popstate', this.restoreHistory);
		this.gesture.start();
		void this.options.navigation.restoreSelection();
	}

	destroy() {
		this.query.removeEventListener('change', this.syncMobile);
		window.removeEventListener('popstate', this.restoreHistory);
		this.gesture.destroy();
	}

	open(pane: Drawer, trigger: HTMLElement | null = this.trigger(pane)) {
		if (trigger) this.returnFocus[pane] = trigger;
		this.options.navigation.setMobileDrawer(pane, 'push');
		void this.focusDrawer(pane);
	}

	rememberTrigger(pane: Drawer, trigger: HTMLElement) {
		this.returnFocus[pane] = trigger;
	}

	close() {
		const usingHistory = isDrawerHistoryEntry();
		const pane = this.options.navigation.mobileDrawer;
		this.options.navigation.closeMobileDrawer();
		if (!usingHistory && pane) window.setTimeout(() => this.restorePaneFocus(pane), 0);
	}

	toggle(pane: Drawer, trigger: HTMLElement) {
		if (this.options.navigation.mobileDrawer === pane) this.close();
		else this.open(pane, trigger);
	}

	private trigger(pane: Drawer) {
		return document.querySelector<HTMLElement>(
			pane === 'projects' ? '[data-drawer-focus]' : '.session-list-back'
		);
	}

	private async focusDrawer(pane: Drawer) {
		await Promise.resolve();
		this.options
			.drawer(pane)
			.querySelector<HTMLElement>(
				'[data-drawer-focus], button:not([disabled]), input:not([disabled])'
			)
			?.focus({ preventScroll: true });
	}

	private restorePaneFocus(pane: Drawer) {
		const target = this.returnFocus[pane] ?? this.trigger(pane);
		delete this.returnFocus[pane];
		if (target?.isConnected) target.focus({ preventScroll: true });
	}

	private restoreHistory = async () => {
		const focused = document.activeElement as HTMLElement | null;
		const closingPane = this.options.navigation.mobileDrawer;
		if (!(await this.options.navigation.restoreSelection())) return;
		const pane = this.options.navigation.mobileDrawer;
		if (pane) return this.focusDrawer(pane);
		if (closingPane) {
			this.restorePaneFocus(closingPane);
			return;
		}
		const focusedPane =
			focused &&
			(['projects', 'sessions'] as const).find((item) =>
				this.options.drawer(item).contains(focused)
			);
		if (focusedPane) this.trigger(focusedPane)?.focus({ preventScroll: true });
	};

	private syncMobile = () => this.options.onMobile(this.query.matches);
}
