import path from "node:path";
import { getGuildKnowledgeSources } from "./db.js";
import { searchDirectoryCode, type CodeSearchMatch } from "./codeSearchEngine.js";

const agentHome = process.env.AGENT_HOME ?? path.dirname(process.env.BOT_DB_PATH ?? path.join(process.cwd(), "..", "bot.db"));
const discordGuildRoot = path.resolve(agentHome, "platform", "Discord", "Guilds");
const slackWorkspaceRoot = path.resolve(agentHome, "platform", "Slack", "Workspaces");

export type KnowledgeCodeSearchResult = {
  query: string;
  repoFullName?: string;
  count: number;
  results: CodeSearchMatch[];
};

function assertSafeClonePath(clonePath: string, rootPath: string) {
  const resolvedClonePath = path.resolve(clonePath);

  if (!resolvedClonePath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Refusing to search a path outside the platform knowledge directory.");
  }

  return resolvedClonePath;
}

async function searchKnowledgeCode(input: {
  contextId: string;
  rootPath: string;
  query: string;
  repoFullName?: string;
  limit?: number;
}): Promise<KnowledgeCodeSearchResult> {
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
  const results: KnowledgeCodeSearchResult["results"] = [];

  for (const source of sources) {
    if (results.length >= limit) {
      break;
    }

    const clonePath = assertSafeClonePath(source.clonePath, input.rootPath);
    const remaining = limit - results.length;

    results.push(
      ...(await searchDirectoryCode({
        repoFullName: source.repoFullName,
        clonePath,
        query,
        limit: remaining,
      })),
    );
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
}): Promise<KnowledgeCodeSearchResult> {
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
}): Promise<KnowledgeCodeSearchResult> {
  return searchKnowledgeCode({
    contextId: input.workspaceId,
    rootPath: slackWorkspaceRoot,
    query: input.query,
    repoFullName: input.repoFullName,
    limit: input.limit,
  });
}
