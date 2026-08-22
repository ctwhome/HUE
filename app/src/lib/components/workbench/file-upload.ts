export async function uploadProjectFiles(projectId: string, input: HTMLInputElement) {
	for (const file of Array.from(input.files ?? [])) {
		const response = await fetch(
			`/api/projects/${projectId}/files?path=${encodeURIComponent(file.name)}`,
			{ method: 'PUT', body: file }
		);
		if (!response.ok) return ((await response.json()) as { error: string }).error;
	}
	return '';
}
