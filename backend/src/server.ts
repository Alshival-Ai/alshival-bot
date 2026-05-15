import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateAgentResponse } from "./agent.js";
import { DiscordPlatformAdapter } from "./platforms/discord.js";
import { PlatformManager } from "./platforms/manager.js";
import type { DiscordGuildSummary } from "./platforms/types.js";

const host = process.env.BACKEND_HOST ?? "127.0.0.1";
const port = Number(process.env.BACKEND_PORT ?? 4000);

const manager = new PlatformManager();
manager.register(new DiscordPlatformAdapter());

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function methodNotAllowed(response: ServerResponse) {
  sendJson(response, 405, { error: "Method not allowed." });
}

function readJsonBody<T>(request: IncomingMessage) {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? (JSON.parse(body) as T) : ({} as T));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

async function handleAgentRoute(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }

  const body = await readJsonBody<{
    input?: unknown;
    source?: unknown;
    guildId?: unknown;
    channelId?: unknown;
    messageId?: unknown;
    authorId?: unknown;
    authorUsername?: unknown;
    authorDisplayName?: unknown;
    authorMention?: unknown;
    sentAt?: unknown;
  }>(request);

  const result = await generateAgentResponse({
    input: typeof body.input === "string" ? body.input : "",
    source: typeof body.source === "string" ? body.source : undefined,
    guildId: typeof body.guildId === "string" ? body.guildId : undefined,
    channelId: typeof body.channelId === "string" ? body.channelId : undefined,
    messageId: typeof body.messageId === "string" ? body.messageId : undefined,
    authorId: typeof body.authorId === "string" ? body.authorId : undefined,
    authorUsername: typeof body.authorUsername === "string" ? body.authorUsername : undefined,
    authorDisplayName:
      typeof body.authorDisplayName === "string" ? body.authorDisplayName : undefined,
    authorMention: typeof body.authorMention === "string" ? body.authorMention : undefined,
    sentAt: typeof body.sentAt === "string" ? body.sentAt : undefined,
  });

  sendJson(response, 200, result);
}

async function handlePlatformRoute(
  request: IncomingMessage,
  response: ServerResponse,
  platform: string,
  action: string,
) {
  const adapter = manager.get(platform);

  if (!adapter) {
    sendJson(response, 404, { error: `Unsupported platform: ${platform}` });
    return;
  }

  if (action === "status") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    sendJson(response, 200, adapter.status());
    return;
  }

  if (action === "start") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    sendJson(response, 200, await adapter.start());
    return;
  }

  if (action === "stop") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    sendJson(response, 200, await adapter.stop());
    return;
  }

  if (platform === "discord" && action === "guilds") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    const guilds = (adapter as DiscordPlatformAdapter).listGuilds();
    sendJson(response, 200, { guilds } satisfies { guilds: DiscordGuildSummary[] });
    return;
  }

  sendJson(response, 404, { error: "Unknown platform action." });
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/agent/respond") {
      await handleAgentRoute(request, response);
      return;
    }

    const match = url.pathname.match(/^\/platforms\/([^/]+)\/([^/]+)$/);
    if (match) {
      await handlePlatformRoute(request, response, match[1], match[2]);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  })().catch((error) => {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  });
});

server.listen(port, host, () => {
  console.log(`Alshival backend listening on http://${host}:${port}`);
  void manager.reconcileAll();
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
