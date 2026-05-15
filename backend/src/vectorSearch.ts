import { ChromaClient } from "chromadb";

type Pipeline = (input: string | string[], options?: Record<string, unknown>) => Promise<unknown>;

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

let embeddingPipeline: Promise<Pipeline> | null = null;

const chromaHost = process.env.CHROMA_HOST ?? "127.0.0.1";
const chromaPort = Number(process.env.CHROMA_PORT ?? 8000);
const embeddingModel = "nomic-ai/nomic-embed-text-v1.5";
const embeddingQuantized = process.env.EMBEDDING_QUANTIZED !== "false";

function getDiscordGuildCollectionName(guildId: string) {
  return `discord_guild_${guildId}`;
}

function getSlackWorkspaceCollectionName(workspaceId: string) {
  return `slack_workspace_${workspaceId}`;
}

async function getPipeline() {
  if (!embeddingPipeline) {
    embeddingPipeline = import("@xenova/transformers").then(async ({ env, pipeline }) => {
      env.allowLocalModels = true;
      return pipeline("feature-extraction", embeddingModel, {
        quantized: embeddingQuantized,
      }) as Promise<Pipeline>;
    });
  }

  return embeddingPipeline;
}

function flattenEmbedding(output: unknown) {
  if (
    typeof output === "object" &&
    output !== null &&
    "tolist" in output &&
    typeof (output as { tolist: unknown }).tolist === "function"
  ) {
    const value = (output as { tolist: () => unknown }).tolist();
    if (Array.isArray(value) && Array.isArray(value[0])) {
      return value[0] as number[];
    }
    return value as number[];
  }

  throw new Error("Embedding model returned an unsupported output shape.");
}

async function embedQuery(query: string) {
  const extractor = await getPipeline();
  const output = await extractor(`search_query: ${query}`, {
    pooling: "mean",
    normalize: true,
  });

  return flattenEmbedding(output);
}

function metadataString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function metadataNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

async function searchCollection(input: {
  collectionName: string;
  contextId: string;
  query: string;
  limit?: number;
}): Promise<KnowledgeKbResult> {
  const query = input.query.trim();

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
  const result = await collection.query({
    queryEmbeddings: [await embedQuery(query)],
    nResults: limit,
  });
  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  return {
    collection: input.collectionName,
    query,
    count: documents.length,
    results: documents.map((document, index) => {
      const metadata = metadatas[index] ?? {};

      return {
        text: document ?? "",
        distance: distances[index] ?? null,
        repoFullName: metadataString(metadata.repoFullName),
        relativePath: metadataString(metadata.relativePath),
        sourceId: metadataNumber(metadata.sourceId),
        chunkIndex: metadataNumber(metadata.chunkIndex),
      };
    }),
  };
}

export async function searchDiscordGuildKb(input: {
  guildId: string;
  query: string;
  limit?: number;
}): Promise<KnowledgeKbResult> {
  return searchCollection({
    collectionName: getDiscordGuildCollectionName(input.guildId),
    contextId: input.guildId,
    query: input.query,
    limit: input.limit,
  });
}

export async function searchSlackWorkspaceKb(input: {
  workspaceId: string;
  query: string;
  limit?: number;
}): Promise<KnowledgeKbResult> {
  return searchCollection({
    collectionName: getSlackWorkspaceCollectionName(input.workspaceId),
    contextId: input.workspaceId,
    query: input.query,
    limit: input.limit,
  });
}
