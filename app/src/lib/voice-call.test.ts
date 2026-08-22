import { describe, expect, it } from 'bun:test';
import { takeSpeakableText } from './voice-call';

describe('voice call speech streaming', () => {
	it('releases complete sentences without replaying prior text', () => {
		const first = takeSpeakableText('First answer. Partial', 0, false);
		expect(first).toEqual({ text: 'First answer. ', offset: 14 });

		const second = takeSpeakableText('First answer. Partial response!', first.offset, false);
		expect(second).toEqual({ text: 'Partial response!', offset: 31 });
	});

	it('flushes an unfinished final sentence when the turn completes', () => {
		expect(takeSpeakableText('A final phrase without punctuation', 0, true)).toEqual({
			text: 'A final phrase without punctuation',
			offset: 34
		});
	});
});
