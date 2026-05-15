import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { getGuildKnowledgeSources } from "./db.js";

const execFileAsync = promisify(execFile);

const agentHome = process.env.AGENT_HOME ?? path.dirname(process.env.BOT_DB_PATH ?? path.join(process.cwd(), "..", "bot.db"));
const discordGuildRoot = path.resolve(agentHome, "platform", "Discord", "Guilds");
const slackWorkspaceRoot = path.resolve(agentHome, "platform", "Slack", "Workspaces");
const defaultContextLines = 2;

export type DiscordGuildCodeSearchResult = {
  query: string;
  repoFullName?: string;
  count: number;
  results: Array<{
    repoFullName: string;
    path: string;
    line: number | null;
    text: string;
  }>;
};

function assertSafeClonePath(clonePath: string, rootPath: string) {
  const resolvedClonePath = path.resolve(clonePath);

  if (!resolvedClonePath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Refusing to search a path outside the platform knowledge directory.");
  }

  return resolvedClonePath;
}

function parseRipgrepLine(repoFullName: string, clonePath: string, line: string) {
  const first = line.indexOf(":");
  if (first < 0) {
    return null;
  }

  const second = line.indexOf(":", first + 1);
  if (second < 0) {
    return null;
  }

  const filePath = line.slice(0, first);
  const lineNumber = Number(line.slice(first + 1, second));
  const text = line.slice(second + 1).trim();

  return {
    repoFullName,
    path: path.relative(clonePath, filePath),
    line: Number.isFinite(lineNumber) ? lineNumber : null,
    text,
  };
}

async function searchKnowledgeCode(input: {
  contextId: string;
  rootPath: string;
  query: string;
  repoFullName?: string;
  limit?: number;
}): Promise<DiscordGuildCodeSearchResult> {
  const query = input.query.trim();

  if (!input.contextId.trim()) {
    throw new Error("context ID is required.");
  }

  if (!query) {
    throw new Error("query is required.");
  }

  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 20), 50));
  const sources = getGuildKnowledgeSources(input.contextId).filter(
    (source) => !input.repoFullName || source.repoFullName === input.repoFullName,
  );
  const results: DiscordGuildCodeSearchResult["results"] = [];

  for (const source of sources) {
    if (results.length >= limit) {
      break;
    }

    const clonePath = assertSafeClonePath(source.clonePath, input.rootPath);
    const remaining = limit - results.length;

    try {
      const { stdout } = await execFileAsync(
        "rg",
        [
          "--fixed-strings",
          "--ignore-case",
          "--line-number",
          "--with-filename",
          "--context",
          String(defaultContextLines),
          "--glob",
          "!node_modules/**",
          "--glob",
          "!.git/**",
          "--glob",
          "!dist/**",
          "--glob",
          "!build/**",
          "--glob",
          "!.next/**",
          "--max-count",
          String(remaining),
          query,
          clonePath,
        ],
        {
          maxBuffer: 1024 * 1024,
        },
      );

      for (const line of stdout.split("\n")) {
        if (!line.trim() || line === "--") {
          continue;
        }

        const parsed = parseRipgrepLine(source.repoFullName, clonePath, line);
        if (parsed) {
          results.push(parsed);
        }

        if (results.length >= limit) {
          break;
        }
      }
    } catch (error) {
      const maybeError = error as { code?: unknown };

      if (maybeError.code === 1) {
        continue;
      }

      throw error;
    }
  }

  return {
    query,
    repoFullName: input.repoFullName,
    count: results.length,
    results,
  };
}

export async function searchDiscordGuildCode(input: {
  guildId: string;
  query: string;
  repoFullName?: string;
  limit?: number;
}): Promise<DiscordGuildCodeSearchResult> {
  return searchKnowledgeCode({
    contextId: input.guildId,
    rootPath: discordGuildRoot,
    query: input.query,
    repoFullName: input.repoFullName,
    limit: input.limit,
  });
}

export async function searchSlackWorkspaceCode(input: {
  workspaceId: string;
  query: string;
  repoFullName?: string;
  limit?: number;
}): Promise<DiscordGuildCodeSearchResult> {
  return searchKnowledgeCode({
    contextId: input.workspaceId,
    rootPath: slackWorkspaceRoot,
    query: input.query,
    repoFullName: input.repoFullName,
    limit: input.limit,
  });
}
