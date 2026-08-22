export async function api<T>(url: string, options?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...options,
		headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }
	});
	const body = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
	return body;
}
