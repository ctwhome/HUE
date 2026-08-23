export function afterInitialPaint(callback: () => void) {
	const idleWindow = window as unknown as {
		requestIdleCallback?: Window['requestIdleCallback'];
		cancelIdleCallback?: Window['cancelIdleCallback'];
		setTimeout: Window['setTimeout'];
		clearTimeout: Window['clearTimeout'];
	};
	let idleId: number | null = null;
	let timeoutId: number | null = null;
	const frameId = requestAnimationFrame(() => {
		if (idleWindow.requestIdleCallback)
			idleId = idleWindow.requestIdleCallback(callback, { timeout: 1_000 });
		else timeoutId = idleWindow.setTimeout(callback, 0);
	});

	return () => {
		cancelAnimationFrame(frameId);
		if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
		if (timeoutId !== null) idleWindow.clearTimeout(timeoutId);
	};
}
