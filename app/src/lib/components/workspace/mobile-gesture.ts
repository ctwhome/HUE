import {
	beginMobileGesture,
	finishMobileGesture,
	updateMobileGesture,
	type MobileGesture,
	type MobilePane
} from './mobile-navigation';

type Drawer = Exclude<MobilePane, null>;
type CloseAction = 'close-projects' | 'close-sessions';
const POST_GESTURE_CLICK_SUPPRESSION_MS = 400;

type MobileGestureOptions = {
	isMobile: () => boolean;
	pane: () => MobilePane;
	hasSession: () => boolean;
	workspace: () => HTMLElement;
	drawer: (pane: Drawer) => HTMLElement;
	open: (pane: Drawer) => void;
	close: (action: CloseAction) => void;
	onVisual: (active: boolean, action: MobileGesture['action']) => void;
};

export class MobileGestureController {
	private gesture: MobileGesture | null = null;
	private gestureDrawer: HTMLElement | null = null;
	private lastX = 0;
	private lastTime = 0;
	private velocityX = 0;
	private suppressClickUntil = 0;
	private suppressClickX = 0;
	private suppressClickY = 0;

	constructor(private options: MobileGestureOptions) {}

	start() {
		document.addEventListener('pointerdown', this.begin, { passive: true });
		window.addEventListener('pointermove', this.move, { passive: false });
		window.addEventListener('pointerup', this.finish);
		window.addEventListener('pointercancel', this.cancel);
		document.addEventListener('click', this.suppressClick, true);
	}

	destroy() {
		document.removeEventListener('pointerdown', this.begin);
		window.removeEventListener('pointermove', this.move);
		window.removeEventListener('pointerup', this.finish);
		window.removeEventListener('pointercancel', this.cancel);
		document.removeEventListener('click', this.suppressClick, true);
	}

	private excluded(target: EventTarget | null, startedOnDrawer: boolean) {
		if (!(target instanceof Element)) return true;
		if (document.querySelector('dialog[open]') || window.getSelection()?.toString()) return true;
		const selector = startedOnDrawer
			? 'input, textarea, select, label, form, dialog, [contenteditable="true"]'
			: 'input, textarea, select, button, a, label, form, dialog, [role="dialog"], [contenteditable="true"], .composer, .message-stack, pre, code, .project-workbench, .files-panel, .file-preview, .terminal-panel, .xterm, canvas, iframe, object, embed';
		return Boolean(target.closest(selector));
	}

	private begin = (event: PointerEvent) => {
		if (!this.options.isMobile() || event.pointerType === 'mouse' || !event.isPrimary) return;
		const pane = this.options.pane();
		const activeDrawer = pane ? this.options.drawer(pane) : null;
		const startedOnDrawer = Boolean(activeDrawer?.contains(event.target as Node));
		this.gesture = beginMobileGesture({
			pane,
			hasSession: this.options.hasSession(),
			startX: event.clientX,
			startY: event.clientY,
			viewportWidth: window.innerWidth,
			startedOnDrawer,
			excluded: this.excluded(event.target, startedOnDrawer),
			dialogOpen: Boolean(document.querySelector('dialog[open]'))
		});
		this.lastX = event.clientX;
		this.lastTime = event.timeStamp;
		this.velocityX = 0;
	};

	private startVisual(gesture: MobileGesture) {
		this.options.onVisual(true, gesture.action);
		this.gestureDrawer =
			gesture.action === 'open-sessions' || gesture.action === 'show-projects'
				? this.options.drawer('sessions')
				: this.options.drawer(gesture.pane!);
		this.gestureDrawer.classList.add('gesture-drawer');
		if (gesture.action === 'show-projects')
			this.options.drawer('projects').classList.add('gesture-revealed-drawer');
	}

	private updateVisual(gesture: MobileGesture) {
		if (!this.gestureDrawer) return;
		const width = this.gestureDrawer.getBoundingClientRect().width;
		let translate = 0;
		let progress = 1;
		if (gesture.action === 'open-sessions') {
			translate = Math.min(0, Math.max(-width, -width + Math.max(0, gesture.deltaX)));
			progress = 1 + translate / width;
		} else if (gesture.action === 'show-projects') {
			translate = Math.min(width, Math.max(0, gesture.deltaX));
		} else {
			translate = Math.min(0, Math.max(-width, gesture.deltaX));
			progress = 1 + translate / width;
		}
		this.gestureDrawer.style.transform = `translate3d(${translate}px, 0, 0)`;
		this.options.workspace().style.setProperty('--drawer-gesture-opacity', String(progress));
	}

	private move = (event: PointerEvent) => {
		if (!this.gesture) return;
		const elapsed = Math.max(1, event.timeStamp - this.lastTime);
		this.velocityX = (event.clientX - this.lastX) / elapsed;
		this.lastX = event.clientX;
		this.lastTime = event.timeStamp;
		this.gesture = updateMobileGesture(this.gesture, event.clientX, event.clientY);
		if (this.gesture.status === 'cancelled') {
			this.gesture = null;
			return;
		}
		if (this.gesture.status !== 'active') return;
		event.preventDefault();
		if (!this.gestureDrawer) this.startVisual(this.gesture);
		this.updateVisual(this.gesture);
	};

	private clearVisual() {
		this.gestureDrawer?.classList.remove('gesture-drawer');
		this.gestureDrawer?.style.removeProperty('transform');
		this.gestureDrawer?.style.removeProperty('transition');
		this.options.drawer('projects').classList.remove('gesture-revealed-drawer');
		this.options.workspace().style.removeProperty('--drawer-gesture-opacity');
		this.gestureDrawer = null;
		this.options.onVisual(false, null);
	}

	private finish = (event: PointerEvent, cancelled = false) => {
		if (!this.gesture) return;
		const gesture = this.gesture;
		this.gesture = null;
		if (gesture.status !== 'active' || !this.gestureDrawer) return;
		const width = this.gestureDrawer.getBoundingClientRect().width;
		const result = cancelled
			? { commit: false, action: gesture.action, destination: null }
			: finishMobileGesture(gesture, width, this.velocityX);
		const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
		const target = result.commit
			? result.action === 'show-projects'
				? width
				: result.action?.startsWith('close-')
					? -width
					: 0
			: result.action === 'open-sessions'
				? -width
				: 0;
		this.gestureDrawer.style.transition = duration
			? 'transform 180ms cubic-bezier(.2,.78,.2,1)'
			: 'none';
		this.gestureDrawer.style.transform = `translate3d(${target}px, 0, 0)`;
		this.options
			.workspace()
			.style.setProperty(
				'--drawer-gesture-opacity',
				String(result.commit && !result.action?.startsWith('close-') ? 1 : result.commit ? 0 : 1)
			);
		this.suppressClickUntil = performance.now() + POST_GESTURE_CLICK_SUPPRESSION_MS;
		this.suppressClickX = event.clientX;
		this.suppressClickY = event.clientY;
		window.setTimeout(() => {
			if (result.commit && result.destination) this.options.open(result.destination);
			else if (result.commit && result.action?.startsWith('close-'))
				this.options.close(result.action as CloseAction);
			this.clearVisual();
		}, duration);
	};

	private cancel = (event: PointerEvent) => this.finish(event, true);

	private suppressClick = (event: MouseEvent) => {
		if (
			performance.now() >= this.suppressClickUntil ||
			Math.hypot(event.clientX - this.suppressClickX, event.clientY - this.suppressClickY) > 32
		)
			return;
		event.preventDefault();
		event.stopPropagation();
	};
}
