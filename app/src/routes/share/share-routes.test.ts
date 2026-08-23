import { expect, test } from 'bun:test';

test('share target stores private content once without cookies or content-bearing redirect', async () => {
	const { POST } = await import('./+server');
	const form = new FormData();
	form.set('title', 'Private title');
	form.set('text', 'Private body');
	const response = await POST({
		request: new Request('http://hue.local/share', {
			method: 'POST',
			headers: { origin: 'http://hue.local' },
			body: form
		})
	} as never);
	expect(response.status).toBe(303);
	expect(response.headers.get('set-cookie')).toBeNull();
	const location = response.headers.get('location')!;
	expect(location).toMatch(/^\/?\?intent=share&token=[0-9a-f-]+$/);
	expect(location).not.toContain('Private');

	const token = new URL(location, 'http://hue.local').searchParams.get('token')!;
	const { GET } = await import('../api/share-intake/[token]/+server');
	const first = await GET({ params: { token } } as never);
	expect(first.headers.get('cache-control')).toContain('no-store');
	expect(first.headers.get('set-cookie')).toBeNull();
	expect(await first.json()).toMatchObject({ text: 'Private title\n\nPrivate body' });
	const second = await GET({ params: { token } } as never);
	expect(second.status).toBe(410);
});

test('share target rejects private content in GET and invalid oversized POST', async () => {
	const { GET, POST } = await import('./+server');
	expect((await GET({} as never)).status).toBe(405);
	const form = new FormData();
	form.set('text', 'x'.repeat(16_001));
	const response = await POST({
		request: new Request('http://hue.local/share', {
			method: 'POST',
			headers: { origin: 'http://hue.local' },
			body: form
		})
	} as never);
	expect(response.status).toBe(400);
	expect(await response.text()).not.toContain('xxxx');
});

test('share target rejects missing and cross-origin form posts without details', async () => {
	const { POST } = await import('./+server');
	for (const origin of [undefined, 'https://attacker.test']) {
		const form = new FormData();
		form.set('text', 'private');
		const headers = origin ? { origin } : undefined;
		const response = await POST({
			request: new Request('http://hue.local/share', { method: 'POST', headers, body: form })
		} as never);
		expect(response.status).toBe(403);
		expect(await response.text()).toBe('Shared content was rejected');
	}
});
