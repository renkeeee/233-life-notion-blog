type Fetcher = (
	input: string,
	init: RequestInit,
) => Promise<Response>;

const defaultFetcher: Fetcher = (input, init) => fetch(input, init);

async function parseJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw new Error(`API request failed: ${response.status}`);
	}

	return (await response.json()) as T;
}

export async function apiGet<T>(
	path: string,
	fetcher: Fetcher = defaultFetcher,
): Promise<T> {
	const response = await fetcher(path, { credentials: "same-origin" });
	return parseJson<T>(response);
}

export async function apiPost<T>(
	path: string,
	body: unknown,
	csrfToken?: string,
	fetcher: Fetcher = defaultFetcher,
): Promise<T> {
	const response = await fetcher(path, {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"content-type": "application/json",
			...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
		},
		body: JSON.stringify(body),
	});
	return parseJson<T>(response);
}
