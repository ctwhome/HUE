import { describe, expect, it } from 'bun:test';
import { automaticSessionIcon, validateIcon } from '../icon';

describe('session icons', () => {
	it('chooses an emoji from an automatic title', () => {
		expect(automaticSessionIcon('Friendly greeting #3')).toBe('👋');
		expect(automaticSessionIcon('Debug failed delivery')).toBe('🐛');
		expect(automaticSessionIcon('Implement project editing')).toBe('🛠️');
		expect(automaticSessionIcon('Uncategorised conversation')).toBe('💬');
	});

	it('accepts short emoji and safe image data only', () => {
		expect(validateIcon('🚀')).toBe('🚀');
		expect(validateIcon(null)).toBeNull();
		expect(() => validateIcon('data:text/html;base64,PHNjcmlwdD4=')).toThrow(
			'Project icon must be a short emoji'
		);
	});
});
