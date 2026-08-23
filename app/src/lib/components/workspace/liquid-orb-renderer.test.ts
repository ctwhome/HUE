import { describe, expect, it } from 'bun:test';
import { createFrameLoop, resizeCanvas } from './liquid-orb-renderer';

describe('liquid orb frame loop', () => {
	it('resizes the canvas only when its pixel dimensions change', () => {
		let width = 100;
		let height = 80;
		let writes = 0;
		const canvas = {
			get width() {
				return width;
			},
			set width(value) {
				width = value;
				writes++;
			},
			get height() {
				return height;
			},
			set height(value) {
				height = value;
				writes++;
			}
		} as HTMLCanvasElement;

		resizeCanvas(canvas, 100, 80);
		resizeCanvas(canvas, 120, 90);

		expect(writes).toBe(2);
	});

	it('cancels its scheduled frame and cannot restart after disposal', () => {
		let callback: FrameRequestCallback | undefined;
		const cancelled: number[] = [];
		let renders = 0;
		const loop = createFrameLoop(
			() => renders++,
			(next) => {
				callback = next;
				return 17;
			},
			(id) => cancelled.push(id)
		);

		loop.start();
		callback?.(10);
		loop.stop();
		callback?.(20);

		expect(renders).toBe(1);
		expect(cancelled).toEqual([17]);
	});

	it('stops and reports renderer errors once', () => {
		let callback: FrameRequestCallback | undefined;
		let errors = 0;
		const loop = createFrameLoop(
			() => {
				throw new Error('render failed');
			},
			(next) => {
				callback = next;
				return 9;
			},
			() => {},
			() => errors++
		);

		loop.start();
		callback?.(10);
		callback?.(20);

		expect(errors).toBe(1);
	});
});
