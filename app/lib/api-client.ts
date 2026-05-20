type Fetcher = (
	input: string,
	init: RequestInit,
) => Promise<Response>;

const defaultFetcher: Fetcher = (input, init) => fetch(input, init);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function apiErrorMessage(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as unknown;
		if (
			isRecord(body) &&
			isRecord(body.error) &&
			typeof body.error.message === "string" &&
			body.error.message.length > 0
		) {
			return body.error.message;
		}
	} catch {
		// Fall back to the status code below when the response is not JSON.
	}

	return `API request failed: ${response.status}`;
}

async function parseJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw new Error(await apiErrorMessage(response));
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

export async function apiPut<T>(
	path: string,
	body: unknown,
	csrfToken: string,
	fetcher: Fetcher = defaultFetcher,
): Promise<T> {
	const response = await fetcher(path, {
		method: "PUT",
		credentials: "same-origin",
		headers: {
			"content-type": "application/json",
			"x-csrf-token": csrfToken,
		},
		body: JSON.stringify(body),
	});
	return parseJson<T>(response);
}

export async function apiDelete<T>(
	path: string,
	csrfToken: string,
	fetcher: Fetcher = defaultFetcher,
): Promise<T> {
	const response = await fetcher(path, {
		method: "DELETE",
		credentials: "same-origin",
		headers: {
			"x-csrf-token": csrfToken,
		},
	});
	return parseJson<T>(response);
}
