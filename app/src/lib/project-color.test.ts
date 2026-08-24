import { describe, expect, it } from 'bun:test';
import { projectColorForeground, validateProjectColor } from './project-color';

describe('Project status color', () => {
	it('accepts canonical six-digit hex colors only', () => {
		expect(validateProjectColor('#007acc')).toBe('#007acc');
		expect(validateProjectColor('#A3BE8C')).toBe('#a3be8c');
		expect(() => validateProjectColor('red')).toThrow('Project color');
		expect(() => validateProjectColor('#fff')).toThrow('Project color');
	});

	it('chooses readable light or dark status text', () => {
		expect(projectColorForeground('#1a1b26')).toBe('#ffffff');
		expect(projectColorForeground('#fdf6e3')).toBe('#111111');
	});
});
