import { expect, test } from 'bun:test';
import { parseApiResponse } from './api-response';

test('parses JSON responses and treats 204 as an empty body', async () => {
	expect(await parseApiResponse<{ value: number }>(Response.json({ value: 3 }))).toEqual({
		value: 3
	});
	expect(
		await parseApiResponse<Record<string, never>>(new Response(null, { status: 204 }))
	).toEqual({});
});
