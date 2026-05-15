const mcpUrl = process.env.MCP_URL ?? "http://127.0.0.1:4100";

export type GifSearchResult = {
  query: string;
  count: number;
  results: Array<{
    id?: string;
    title?: string;
    url: string;
  }>;
  poweredBy: string;
  ts: string;
};

async function requestMcpJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${mcpUrl}${path}`, {
    ...init,
    cache: "no-store",
  });
  const data = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && data.error
        ? data.error
        : "MCP request failed.";
    throw new Error(message);
  }

  return data as T;
}

export async function searchGif(input: { query: string; limit?: number }) {
  return requestMcpJson<GifSearchResult>("/tools/search_gif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
