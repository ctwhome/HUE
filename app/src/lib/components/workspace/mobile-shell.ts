import { MobileGestureController } from './mobile-gesture';
import type { MobileGesture, MobilePane } from './mobile-navigation';

type Drawer = Exclude<MobilePane, null>;
type Navigation = {
	mobileDrawer: MobilePane;
	selectedSession: unknown;
	setMobileDrawer: (pane: Drawer, mode: 'push') => void;
	closeMobileDrawer: () => void;
	restoreSelection: () => Promise<boolean>;
};

type MobileShellOptions = {
	workspace: () => HTMLElement;
	drawer: (pane: Drawer) => HTMLElement;
	navigation: Navigation;
	onMobile: (mobile: boolean) => void;
	onVisual: (active: boolean, action: MobileGesture['action']) => void;
};

export class MobileShellController {
	private query = matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 500px)');
	private returnFocus: HTMLElement | null = null;
	private gesture: MobileGestureController;

	constructor(private options: MobileShellOptions) {
		this.gesture = new MobileGestureController({
			isMobile: () => this.query.matches,
			pane: () => options.navigation.mobileDrawer,
			hasSession: () => Boolean(options.navigation.selectedSession),
			workspace: options.workspace,
			drawer: options.drawer,
			open: (pane) => this.open(pane),
			close: (action) => {
				if (action === 'close-sessions') this.returnFocus = this.trigger('sessions');
				this.close();
			},
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
		this.returnFocus = trigger;
		this.options.navigation.setMobileDrawer(pane, 'push');
		void this.focusDrawer(pane);
	}

	close() {
		const usingHistory = Boolean(
			window.history.state?.hueWorkspace && window.history.state?.drawerEntry
		);
		this.options.navigation.closeMobileDrawer();
		if (!usingHistory) window.setTimeout(this.restoreFocus, 0);
	}

	toggle(pane: Drawer, trigger: HTMLElement) {
		if (this.options.navigation.mobileDrawer === pane) this.close();
		else this.open(pane, trigger);
	}

	private trigger(pane: Drawer) {
		return document.querySelector<HTMLElement>(
			`.mobile-navigation [aria-controls="${pane === 'projects' ? 'project' : 'session'}-drawer"]`
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

	private restoreFocus = () => {
		const target = this.returnFocus;
		this.returnFocus = null;
		if (target?.isConnected) target.focus({ preventScroll: true });
	};

	private restoreHistory = async () => {
		const focused = document.activeElement as HTMLElement | null;
		const closingPane = this.options.navigation.mobileDrawer;
		if (!(await this.options.navigation.restoreSelection())) return;
		const pane = this.options.navigation.mobileDrawer;
		if (pane) return this.focusDrawer(pane);
		if (closingPane) {
			this.returnFocus = null;
			this.trigger(closingPane)?.focus({ preventScroll: true });
			return;
		}
		const focusedPane =
			focused &&
			(['projects', 'sessions'] as const).find((item) =>
				this.options.drawer(item).contains(focused)
			);
		if (focusedPane) this.trigger(focusedPane)?.focus({ preventScroll: true });
		else this.restoreFocus();
	};

	private syncMobile = () => this.options.onMobile(this.query.matches);
}
