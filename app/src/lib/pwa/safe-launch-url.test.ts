import { expect, test } from 'bun:test';
import { safeLaunchUrl } from './safe-launch-url';

test('notification launch accepts same-origin deep links and rejects external or malformed URLs', () => {
	expect(safeLaunchUrl('/?project=project-1&session=session-1', 'https://hue.test')).toBe(
		'https://hue.test/?project=project-1&session=session-1'
	);
	expect(safeLaunchUrl('https://attacker.test/private', 'https://hue.test')).toBe(
		'https://hue.test/'
	);
	expect(safeLaunchUrl('http://[', 'https://hue.test')).toBe('https://hue.test/');
});
