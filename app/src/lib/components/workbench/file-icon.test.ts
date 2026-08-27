import { expect, test } from 'bun:test';
import { fileIconKind } from './file-icon';

test('classifies developer files by useful visual type', () => {
	expect(fileIconKind('src/app.ts')).toBe('code');
	expect(fileIconKind('Component.svelte')).toBe('code');
	expect(fileIconKind('README.md')).toBe('markdown');
	expect(fileIconKind('package.json')).toBe('config');
	expect(fileIconKind('.env.example')).toBe('config');
	expect(fileIconKind('Makefile')).toBe('config');
	expect(fileIconKind('bun.lock')).toBe('lock');
});

test('classifies media, office, archive, and data files', () => {
	expect(fileIconKind('hero.png')).toBe('image');
	expect(fileIconKind('demo.mp4')).toBe('video');
	expect(fileIconKind('voice.wav')).toBe('audio');
	expect(fileIconKind('brief.pdf')).toBe('pdf');
	expect(fileIconKind('slides.pptx')).toBe('presentation');
	expect(fileIconKind('budget.xlsx')).toBe('spreadsheet');
	expect(fileIconKind('proposal.docx')).toBe('document');
	expect(fileIconKind('backup.zip')).toBe('archive');
	expect(fileIconKind('local.sqlite')).toBe('database');
	expect(fileIconKind('notes.txt')).toBe('text');
	expect(fileIconKind('unknown.bin')).toBe('file');
});
