import { ChromaClient, type Where } from "chromadb";
import { embedQuery, getKnowledgeCollectionName } from "./embeddings.js";

export type KnowledgeKbResult = {
  collection: string;
  query: string;
  count: number;
  results: Array<{
    text: string;
    distance: number | null;
    repoFullName: string | null;
    relativePath: string | null;
    sourceId: number | null;
    chunkIndex: number | null;
  }>;
};

type KnowledgeKbSearchResult = KnowledgeKbResult["results"][number];

const chromaHost = process.env.CHROMA_HOST ?? "127.0.0.1";
const chromaPort = Number(process.env.CHROMA_PORT ?? 8000);
const broadSearchOverfetchLimit = 50;

function getDiscordGuildCollectionName(guildId: string) {
  return getKnowledgeCollectionName(guildId, "discord");
}

function getSlackWorkspaceCollectionName(workspaceId: string) {
  return getKnowledgeCollectionName(workspaceId, "slack");
}

function metadataString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function metadataNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function getBroadSearchResultLimit(limit: number) {
  return Math.min(broadSearchOverfetchLimit, Math.max(limit * 4, 20));
}

function sourceKey(result: KnowledgeKbSearchResult) {
  return result.repoFullName ?? `source:${result.sourceId ?? "unknown"}`;
}

function fileKey(result: KnowledgeKbSearchResult) {
  return `${sourceKey(result)}:${result.relativePath ?? "unknown"}`;
}

export function buildKnowledgeQueryOptions(input: {
  queryEmbedding: number[];
  limit: number;
  repoFullName?: string;
}) {
  const repoFullName = input.repoFullName?.trim();
  const where: Where | undefined = repoFullName ? { repoFullName } : undefined;

  return {
    queryEmbeddings: [input.queryEmbedding],
    nResults: where ? input.limit : getBroadSearchResultLimit(input.limit),
    ...(where ? { where } : {}),
  };
}

export function diversifyBroadResults(results: KnowledgeKbSearchResult[], limit: number) {
  if (results.length <= limit) {
    return results;
  }

  const repoCap = Math.max(2, Math.ceil(limit / 2));
  const fileCap = Math.max(1, Math.floor(limit / 3));
  const selected: KnowledgeKbSearchResult[] = [];
  const deferred: KnowledgeKbSearchResult[] = [];
  const repoCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();

  for (const result of results) {
    const repo = sourceKey(result);
    const file = fileKey(result);
    const repoCount = repoCounts.get(repo) ?? 0;
    const fileCount = fileCounts.get(file) ?? 0;

    if (selected.length < limit && repoCount < repoCap && fileCount < fileCap) {
      selected.push(result);
      repoCounts.set(repo, repoCount + 1);
      fileCounts.set(file, fileCount + 1);
    } else {
      deferred.push(result);
    }
  }

  for (const result of deferred) {
    if (selected.length >= limit) {
      break;
    }

    selected.push(result);
  }

  return selected;
}

async function searchCollection(input: {
  collectionName: string;
  contextId: string;
  query: string;
  limit?: number;
  repoFullName?: string;
}): Promise<KnowledgeKbResult> {
  const query = input.query.trim();
  const repoFullName = input.repoFullName?.trim();

  if (!input.contextId.trim()) {
    throw new Error("context ID is required.");
  }

  if (!query) {
    throw new Error("query is required.");
  }

  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 5), 10));
  const client = new ChromaClient({ host: chromaHost, port: chromaPort });
  const collection = await client.getCollection({
    name: input.collectionName,
  });
  const result = await collection.query(
    buildKnowledgeQueryOptions({
      queryEmbedding: await embedQuery(query),
      limit,
      repoFullName,
    }),
  );
  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];
  const results = documents.map((document, index) => {
    const metadata = metadatas[index] ?? {};

    return {
      text: document ?? "",
      distance: distances[index] ?? null,
      repoFullName: metadataString(metadata.repoFullName),
      relativePath: metadataString(metadata.relativePath),
      sourceId: metadataNumber(metadata.sourceId),
      chunkIndex: metadataNumber(metadata.chunkIndex),
    };
  });
  const selectedResults = repoFullName ? results : diversifyBroadResults(results, limit);

  return {
    collection: input.collectionName,
    query,
    count: selectedResults.length,
    results: selectedResults,
  };
}

export async function searchDiscordGuildKb(input: {
  guildId: string;
  query: string;
  limit?: number;
  repoFullName?: string;
}): Promise<KnowledgeKbResult> {
  return searchCollection({
    collectionName: getDiscordGuildCollectionName(input.guildId),
    contextId: input.guildId,
    query: input.query,
    limit: input.limit,
    repoFullName: input.repoFullName,
  });
}

export async function searchSlackWorkspaceKb(input: {
  workspaceId: string;
  query: string;
  limit?: number;
  repoFullName?: string;
}): Promise<KnowledgeKbResult> {
  return searchCollection({
    collectionName: getSlackWorkspaceCollectionName(input.workspaceId),
    contextId: input.workspaceId,
    query: input.query,
    limit: input.limit,
    repoFullName: input.repoFullName,
  });
}
