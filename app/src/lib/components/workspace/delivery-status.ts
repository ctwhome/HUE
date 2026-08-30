const icons = {
	saving: 'save',
	accepted: 'clock',
	running: 'loader',
	reconnecting: 'refresh',
	cancelling: 'stop',
	completed: 'check',
	failed: 'error',
	'not accepted': 'error',
	cancelled: 'cancelled'
} as const;

export type DeliveryStatusIcon = (typeof icons)[keyof typeof icons] | 'unknown' | 'status';

export function deliveryStatusIcon(delivery: string): DeliveryStatusIcon {
	if (delivery.includes('unknown')) return 'unknown';
	return icons[delivery as keyof typeof icons] ?? 'status';
}
