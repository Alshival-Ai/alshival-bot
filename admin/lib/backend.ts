const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:4000";

export type PlatformRuntimeStatus = {
  platform: string;
  configured: boolean;
  enabled: boolean;
  desiredRunning: boolean;
  running: boolean;
  ready: boolean;
  displayName?: string;
  error?: string;
};

export type DiscordGuildSummary = {
  id: string;
  name: string;
  memberCount: number | null;
  iconUrl: string | null;
  available: boolean;
  ownerId: string | null;
};

export type AgentResponse = {
  provider: string;
  model: string;
  text: string;
};

async function requestBackend(path: string, init?: RequestInit) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...init,
    cache: "no-store",
  });

  const data = (await response.json()) as PlatformRuntimeStatus | { error?: string };

  if (!response.ok) {
    throw new Error("error" in data && data.error ? data.error : "Backend request failed.");
  }

  return data as PlatformRuntimeStatus;
}

function getBackendError(data: unknown) {
  if (typeof data === "object" && data !== null && "error" in data) {
    const error = (data as { error?: unknown }).error;
    return typeof error === "string" ? error : null;
  }

  return null;
}

async function requestBackendJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...init,
    cache: "no-store",
  });

  const data = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    throw new Error(getBackendError(data) ?? "Backend request failed.");
  }

  return data as T;
}

export async function getPlatformRuntime(platform: string) {
  return requestBackend(`/platforms/${platform}/status`);
}

export async function startPlatform(platform: string) {
  return requestBackend(`/platforms/${platform}/start`, { method: "POST" });
}

export async function stopPlatform(platform: string) {
  return requestBackend(`/platforms/${platform}/stop`, { method: "POST" });
}

export async function getDiscordGuilds() {
  return requestBackendJson<{ guilds: DiscordGuildSummary[] }>("/platforms/discord/guilds");
}

export async function generateAgentResponse(input: string) {
  return requestBackendJson<AgentResponse>("/agent/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, source: "admin" }),
  });
}
