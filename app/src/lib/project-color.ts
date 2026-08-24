export function validateProjectColor(value: unknown): string {
	if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
		throw new Error('Project color must be a six-digit hex color');
	}
	return value.toLowerCase();
}

export function projectColorForeground(color: string): '#111111' | '#ffffff' {
	const channels = color
		.slice(1)
		.match(/.{2}/g)!
		.map((channel) => Number.parseInt(channel, 16) / 255)
		.map((channel) =>
			channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
		);
	const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	return luminance > 0.179 ? '#111111' : '#ffffff';
}
