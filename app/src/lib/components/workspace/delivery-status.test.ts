import { expect, test } from 'bun:test';
import { deliveryStatusIcon } from './delivery-status';

test('maps delivery states to distinct semantic icons', () => {
	expect(
		Object.fromEntries(
			[
				'saving',
				'accepted',
				'running',
				'reconnecting',
				'cancelling',
				'completed',
				'failed',
				'not accepted',
				'cancelled',
				'delivery unknown',
				'unrecognized'
			].map((status) => [status, deliveryStatusIcon(status)])
		)
	).toEqual({
		saving: 'save',
		accepted: 'clock',
		running: 'loader',
		reconnecting: 'refresh',
		cancelling: 'stop',
		completed: 'check',
		failed: 'error',
		'not accepted': 'error',
		cancelled: 'cancelled',
		'delivery unknown': 'unknown',
		unrecognized: 'status'
	});
});
