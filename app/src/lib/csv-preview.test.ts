import { expect, test } from 'bun:test';
import { parseCsvPreview } from './csv-preview';

test('parses quoted CSV cells and reports bounded previews', () => {
	expect(parseCsvPreview('name,note\r\nHermes,"ready, now"\r\n"multi\nline","say ""hi"""')).toEqual(
		{
			rows: [
				['name', 'note'],
				['Hermes', 'ready, now'],
				['multi\nline', 'say "hi"']
			],
			truncated: false
		}
	);
	expect(parseCsvPreview('a,b,c\n1,2,3\n4,5,6', 2, 2)).toEqual({
		rows: [
			['a', 'b'],
			['1', '2']
		],
		truncated: true
	});
});
