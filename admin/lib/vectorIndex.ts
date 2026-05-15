import { ChromaClient } from "chromadb";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type ExtractedMarkdownFile = {
  filePath: string;
  relativePath: string;
  content: string;
};

type MarkdownChunk = {
  id: string;
  text: string;
  relativePath: string;
  chunkIndex: number;
};

type Pipeline = (input: string | string[], options?: Record<string, unknown>) => Promise<unknown>;

let embeddingPipeline: Promise<Pipeline> | null = null;

const chromaHost = process.env.CHROMA_HOST ?? "127.0.0.1";
const chromaPort = Number(process.env.CHROMA_PORT ?? 8000);
const embeddingModel = "nomic-ai/nomic-embed-text-v1.5";
const embeddingPrefix = "search_document";
const embeddingQuantized = process.env.EMBEDDING_QUANTIZED !== "false";

function getGuildCollectionName(guildId: string, platform: "discord" | "slack" = "discord") {
  if (platform === "slack") {
    return `slack_workspace_${guildId}`;
  }

  return `discord_guild_${guildId}`;
}

function stableId(...parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
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

async function embedTexts(texts: string[]) {
  const extractor = await getPipeline();
  const embeddings: number[][] = [];

  for (const text of texts) {
    const output = await extractor(`${embeddingPrefix}: ${text}`, {
      pooling: "mean",
      normalize: true,
    });
    embeddings.push(flattenEmbedding(output));
  }

  return embeddings;
}

async function collectMarkdownFiles(rootPath: string, currentPath = rootPath): Promise<ExtractedMarkdownFile[]> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const files: ExtractedMarkdownFile[] = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(rootPath, entryPath)));
      continue;
    }

    if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      files.push({
        filePath: entryPath,
        relativePath: path.relative(rootPath, entryPath),
        content: await fs.readFile(entryPath, "utf8"),
      });
    }
  }

  return files;
}

function chunkMarkdown(file: ExtractedMarkdownFile) {
  const maxChars = 1600;
  const overlapChars = 200;
  const chunks: MarkdownChunk[] = [];
  const normalized = file.content.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return chunks;
  }

  for (let start = 0, chunkIndex = 0; start < normalized.length; chunkIndex += 1) {
    const end = Math.min(start + maxChars, normalized.length);
    const text = normalized.slice(start, end).trim();

    if (text) {
      chunks.push({
        id: stableId(file.relativePath, String(chunkIndex), text),
        text,
        relativePath: file.relativePath,
        chunkIndex,
      });
    }

    if (end === normalized.length) {
      break;
    }

    start = Math.max(end - overlapChars, start + 1);
  }

  return chunks;
}

export async function indexRepositoryMarkdown(input: {
  guildId: string;
  sourceId: number;
  repoFullName: string;
  clonePath: string;
  platform?: "discord" | "slack";
}) {
  const platform = input.platform ?? "discord";
  const collectionName = getGuildCollectionName(input.guildId, platform);
  const client = new ChromaClient({ host: chromaHost, port: chromaPort });
  const collection = await client.getOrCreateCollection({
    name: collectionName,
    metadata: {
      platform,
      contextPlatform: platform,
      guildId: input.guildId,
      workspaceId: platform === "slack" ? input.guildId : "",
      embeddingModel,
      embeddingPrefix,
      embeddingQuantized: String(embeddingQuantized),
    },
    embeddingFunction: null,
  });
  const files = await collectMarkdownFiles(input.clonePath);
  const chunks = files.flatMap(chunkMarkdown);

  await collection.delete({
    where: {
      sourceId: input.sourceId,
    },
  });

  for (let start = 0; start < chunks.length; start += 16) {
    const batch = chunks.slice(start, start + 16);

    if (batch.length === 0) {
      continue;
    }

    await collection.add({
      ids: batch.map((chunk) => `${input.sourceId}:${chunk.id}`),
      documents: batch.map((chunk) => chunk.text),
      embeddings: await embedTexts(batch.map((chunk) => chunk.text)),
      metadatas: batch.map((chunk) => ({
        platform: "github",
        contextPlatform: platform,
        guildId: input.guildId,
        workspaceId: platform === "slack" ? input.guildId : "",
        sourceId: input.sourceId,
        repoFullName: input.repoFullName,
        relativePath: chunk.relativePath,
        chunkIndex: chunk.chunkIndex,
        embeddingModel,
        embeddingPrefix,
        embeddingQuantized: String(embeddingQuantized),
      })),
    });
  }

  return {
    collectionName,
    markdownFiles: files.length,
    chunks: chunks.length,
  };
}

export async function deleteRepositoryVectors(input: {
  guildId: string;
  sourceId: number;
  platform?: "discord" | "slack";
}) {
  const client = new ChromaClient({ host: chromaHost, port: chromaPort });
  const collection = await client.getOrCreateCollection({
    name: getGuildCollectionName(input.guildId, input.platform ?? "discord"),
    embeddingFunction: null,
  });

  await collection.delete({
    where: {
      sourceId: input.sourceId,
    },
  });
}
