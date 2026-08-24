import { tick } from 'svelte';
import { isTurnBusy } from '$lib';
import { resolveNotificationTarget } from './notification-target';
import type { SessionEvent } from './types';

export class TranscriptFollow {
	element = $state<HTMLElement>();
	following = $state(true);
	showScrollToLatest = $state(false);
	private automaticScrollUntil = 0;
	private settleUntil = 0;
	private beginEntryStick: (() => void) | null = null;
	private endEntryStick: (() => void) | null = null;
	private highlightTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private getDelivery: () => string) {}

	begin = () => this.beginEntryStick?.();

	settle() {
		this.settleUntil = Date.now() + 300;
	}

	scrollToLatest = async (behavior: ScrollBehavior = 'auto') => {
		await tick();
		this.writeLatest(behavior);
	};

	focusNotificationTarget = async (events: SessionEvent[], sourceEventId: string | null) => {
		const target = resolveNotificationTarget(events, sourceEventId);
		if (!target || !this.element) return false;
		await tick();
		const bySequence = [...this.element.querySelectorAll<HTMLElement>('[data-timeline-sequence]')].find(
			(element) => element.dataset.timelineSequence === String(target.sequence)
		);
		const byMessage = target.messageId
			? [...this.element.querySelectorAll<HTMLElement>('[data-message-id]')]
					.filter((element) => element.dataset.messageId === target.messageId)
					.at(-1)
			: null;
		const element = bySequence ?? byMessage;
		if (!element) return false;
		this.endEntryStick?.();
		this.following = false;
		this.showScrollToLatest = false;
		element.scrollIntoView({
			block: 'center',
			behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		});
		element.classList.add('notification-target');
		const focusTarget = target.actionable
			? element.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')
			: null;
		(focusTarget ?? element).focus({ preventScroll: true });
		if (this.highlightTimer) clearTimeout(this.highlightTimer);
		this.highlightTimer = setTimeout(() => element.classList.remove('notification-target'), 4_000);
		return true;
	};

	private writeLatest(behavior: ScrollBehavior = 'auto') {
		if (!this.element) return;
		this.following = true;
		this.showScrollToLatest = false;
		this.automaticScrollUntil = performance.now() + (behavior === 'smooth' ? 750 : 100);
		const top = this.element.scrollHeight + 4096;
		if (behavior === 'smooth') this.element.scrollTo({ top, behavior });
		else this.element.scrollTop = top;
	}

	follow = (node: HTMLElement) => {
		let lastTop = node.scrollTop;
		let touchY: number | null = null;
		let entryStick = true;
		let entryHeight = node.scrollHeight;
		let quietTimer: ReturnType<typeof setTimeout>;
		let capTimer: ReturnType<typeof setTimeout>;
		const beginEntryStick = () => {
			entryStick = true;
			entryHeight = node.scrollHeight;
			clearTimeout(quietTimer);
			clearTimeout(capTimer);
			quietTimer = setTimeout(() => (entryStick = false), 600);
			capTimer = setTimeout(() => (entryStick = false), 8_000);
		};
		const endEntryStick = () => {
			entryStick = false;
			clearTimeout(quietTimer);
			clearTimeout(capTimer);
		};
		this.beginEntryStick = beginEntryStick;
		this.endEntryStick = endEntryStick;
		beginEntryStick();

		const distanceFromBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;
		const bottomZone = () =>
			matchMedia('(max-width: 700px)').matches ? 40 : Math.max(48, node.clientHeight * 0.1);
		const canScroll = () => node.scrollHeight - node.clientHeight > 1;
		const updateButton = () => {
			this.showScrollToLatest =
				canScroll() && !this.following && distanceFromBottom() > bottomZone();
		};
		const release = () => {
			entryStick = false;
			this.following = !canScroll();
			updateButton();
		};
		const handleScroll = () => {
			const scrollingDown = node.scrollTop > lastTop + 0.5;
			lastTop = node.scrollTop;
			if (!canScroll()) {
				this.following = true;
				updateButton();
				return;
			}
			const distance = distanceFromBottom();
			if (distance <= bottomZone()) {
				if (scrollingDown || this.following || distance <= 2) this.following = true;
				updateButton();
				return;
			}
			if (this.following && performance.now() < this.automaticScrollUntil) return;
			release();
		};
		const handleWheel = (event: WheelEvent) => event.deltaY < 0 && release();
		const handleTouchStart = (event: TouchEvent) => {
			touchY = event.touches.item(0)?.clientY ?? null;
		};
		const handleTouchMove = (event: TouchEvent) => {
			const nextY = event.touches.item(0)?.clientY ?? null;
			if (nextY !== null && touchY !== null && nextY - touchY > 2) release();
			touchY = nextY;
		};
		const handleKeydown = (event: KeyboardEvent) => {
			if (
				!event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				['ArrowUp', 'PageUp', 'Home'].includes(event.key)
			)
				release();
		};
		const observer = new ResizeObserver(() => {
			updateButton();
			if (entryStick) {
				const grew = node.scrollHeight > entryHeight + 1;
				entryHeight = node.scrollHeight;
				this.writeLatest();
				if (grew) {
					clearTimeout(quietTimer);
					quietTimer = setTimeout(() => (entryStick = false), 600);
				}
				return;
			}
			if (this.following && (isTurnBusy(this.getDelivery()) || Date.now() < this.settleUntil)) {
				this.writeLatest();
			}
		});

		node.addEventListener('scroll', handleScroll, { passive: true });
		node.addEventListener('wheel', handleWheel, { passive: true });
		node.addEventListener('touchstart', handleTouchStart, { passive: true });
		node.addEventListener('touchmove', handleTouchMove, { passive: true });
		node.addEventListener('keydown', handleKeydown);
		observer.observe(node);
		if (node.firstElementChild) observer.observe(node.firstElementChild);

		return {
				destroy: () => {
					if (this.beginEntryStick === beginEntryStick) this.beginEntryStick = null;
					if (this.endEntryStick === endEntryStick) this.endEntryStick = null;
					if (this.highlightTimer) clearTimeout(this.highlightTimer);
				clearTimeout(quietTimer);
				clearTimeout(capTimer);
				observer.disconnect();
				node.removeEventListener('scroll', handleScroll);
				node.removeEventListener('wheel', handleWheel);
				node.removeEventListener('touchstart', handleTouchStart);
				node.removeEventListener('touchmove', handleTouchMove);
				node.removeEventListener('keydown', handleKeydown);
			}
		};
	};
}
