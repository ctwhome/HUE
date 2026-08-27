export type SessionRowStateInput = {
	status?:
		'running' | 'waiting-permission' | 'waiting-answer' | 'unknown' | 'failed' | 'cancelled' | null;
	busySince?: string | null;
	delivery?: string;
	unreadAttention?: boolean;
};

export function sessionRowState(input: SessionRowStateInput) {
	const label =
		input.delivery === 'cancelling'
			? 'Cancelling'
			: input.delivery === 'cancelled' || input.status === 'cancelled'
				? 'Cancelled'
				: input.delivery === 'delivery unknown' || input.status === 'unknown'
					? 'Interrupted, delivery unknown'
					: input.delivery === 'failed' || input.status === 'failed'
						? 'Failed'
						: input.status === 'waiting-permission'
							? 'Waiting for permission'
							: input.status === 'waiting-answer'
								? 'Waiting for answer'
								: input.busySince ||
									  ['saving', 'accepted', 'running', 'reconnecting'].includes(
											input.delivery ?? ''
									  ) ||
									  input.status === 'running'
									? 'Running'
									: 'Idle';
	const icon =
		label === 'Running' || label === 'Cancelling'
			? 'running'
			: label.startsWith('Waiting')
				? 'waiting'
				: label === 'Failed'
					? 'failed'
					: label === 'Cancelled'
						? 'cancelled'
						: label === 'Interrupted, delivery unknown'
							? 'unknown'
							: 'idle';
	const attention =
		input.unreadAttention === true ||
		[
			'Waiting for permission',
			'Waiting for answer',
			'Interrupted, delivery unknown',
			'Failed'
		].includes(label);
	return {
		label,
		icon,
		attention,
		...(input.unreadAttention ? { note: 'Unread attention' } : {})
	};
}
