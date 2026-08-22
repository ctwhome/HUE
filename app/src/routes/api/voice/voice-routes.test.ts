import { describe, expect, it } from 'bun:test';
import { POST as speak } from './speak/+server';
import { POST as transcribe } from './transcribe/+server';

function event(body: unknown) {
	return {
		request: new Request('http://localhost/api/voice', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as never;
}

describe('voice API boundaries', () => {
	it('rejects non-audio transcription payloads', async () => {
		const response = await transcribe(
			event({
				dataUrl: 'data:text/html;base64,AAAA',
				mimeType: 'text/html'
			})
		);
		expect(response.status).toBe(400);
	});

	it('rejects data URLs whose declared MIME only shares an audio prefix', async () => {
		const response = await transcribe(
			event({ dataUrl: 'data:audio/webm-unsupported;base64,AAAA', mimeType: 'audio/webm' })
		);
		expect(response.status).toBe(400);
	});

	it('rejects unbounded speech text', async () => {
		const response = await speak(event({ text: 'x'.repeat(20_001) }));
		expect(response.status).toBe(413);
	});
});
