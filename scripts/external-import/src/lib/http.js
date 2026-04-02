const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; EventDeskExternalImporter/1.0; +https://eventdesk.local)',
  'accept-language': 'en-IN,en;q=0.9'
};

export async function fetchText(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...headers
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

export function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
