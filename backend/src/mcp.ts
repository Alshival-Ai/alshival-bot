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

export type McpReminder = {
  id: number;
  platform: string;
  guildId: string | null;
  channelId: string | null;
  authorId: string | null;
  authorMention: string | null;
  title: string;
  message: string | null;
  remindAt: string;
  status: "pending" | "sending" | "sent" | "cancelled";
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export type McpReminderResult = {
  reminder: McpReminder | null;
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

export async function setReminder(input: {
  platform: string;
  guildId?: string;
  channelId?: string;
  authorId?: string;
  authorMention?: string;
  title: string;
  message?: string;
  remindAt: string;
}) {
  return requestMcpJson<McpReminderResult>("/tools/set_reminder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function editReminder(input: {
  id: number;
  title?: string;
  message?: string;
  remindAt?: string;
}) {
  return requestMcpJson<McpReminderResult>("/tools/edit_reminder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteReminder(input: { id: number }) {
  return requestMcpJson<McpReminderResult>("/tools/delete_reminder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
