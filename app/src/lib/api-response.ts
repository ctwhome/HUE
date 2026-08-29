export async function parseApiResponse<T>(response: Response): Promise<T & { error?: string }> {
	return response.status === 204 ? ({} as T & { error?: string }) : response.json();
}
