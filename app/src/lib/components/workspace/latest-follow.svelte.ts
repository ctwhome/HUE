export class LatestFollow {
	showLatest = $state(false);
	private node?: HTMLElement;
	private following = true;
	private automaticScrollUntil = 0;

	scrollToLatest = (behavior: ScrollBehavior = 'auto') => {
		if (!this.node) return;
		this.following = true;
		this.showLatest = false;
		this.automaticScrollUntil = performance.now() + (behavior === 'smooth' ? 750 : 100);
		const top = this.node.scrollHeight + 4096;
		if (behavior === 'smooth') this.node.scrollTo({ top, behavior });
		else this.node.scrollTop = top;
	};

	followLatest = (node: HTMLElement) => {
		this.node = node;
		let touchY: number | null = null;
		const distanceFromBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;
		const canScroll = () => node.scrollHeight - node.clientHeight > 1;
		const update = () => {
			this.showLatest = canScroll() && !this.following && distanceFromBottom() > 2;
		};
		const release = () => {
			this.following = !canScroll();
			update();
		};
		const handleScroll = () => {
			const distance = distanceFromBottom();
			if (!canScroll() || distance <= 2) {
				this.following = true;
				update();
				return;
			}
			if (this.following && performance.now() < this.automaticScrollUntil) return;
			this.following = false;
			update();
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
			) {
				release();
			}
		};
		const observer = new ResizeObserver(() => {
			if (this.following) this.scrollToLatest('auto');
			else update();
		});

		node.addEventListener('scroll', handleScroll, { passive: true });
		node.addEventListener('wheel', handleWheel, { passive: true });
		node.addEventListener('touchstart', handleTouchStart, { passive: true });
		node.addEventListener('touchmove', handleTouchMove, { passive: true });
		node.addEventListener('keydown', handleKeydown);
		observer.observe(node);
		if (node.firstElementChild) observer.observe(node.firstElementChild);
		queueMicrotask(() => this.scrollToLatest('auto'));

		return {
			destroy: () => {
				if (this.node === node) this.node = undefined;
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
