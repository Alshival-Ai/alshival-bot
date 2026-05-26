import { ChromaClient, type Where } from "chromadb";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { embedTexts, getEmbeddingConfig, getKnowledgeCollectionName } from "./embeddings.js";

export type ExtractedMarkdownFile = {
  filePath: string;
  relativePath: string;
  content: string;
  hash: string;
};

export type MarkdownManifest = Record<string, string>;

type MarkdownChunk = {
  id: string;
  text: string;
  relativePath: string;
  chunkIndex: number;
};

const chromaHost = process.env.CHROMA_HOST ?? "127.0.0.1";
const chromaPort = Number(process.env.CHROMA_PORT ?? 8000);

function stableId(...parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
}

function hashContent(content: string) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function collectMarkdownFiles(
  rootPath: string,
  currentPath = rootPath,
): Promise<ExtractedMarkdownFile[]> {
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
      const content = await fs.readFile(entryPath, "utf8");
      files.push({
        filePath: entryPath,
        relativePath: path.relative(rootPath, entryPath),
        content,
        hash: hashContent(content),
      });
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function buildMarkdownManifest(files: ExtractedMarkdownFile[]): MarkdownManifest {
  return Object.fromEntries(files.map((file) => [file.relativePath, file.hash]));
}

export function stringifyMarkdownManifest(manifest: MarkdownManifest) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))),
  );
}

export function parseMarkdownManifest(value: string | null): MarkdownManifest | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const manifest: MarkdownManifest = {};
    for (const [key, hash] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof hash === "string") {
        manifest[key] = hash;
      }
    }

    return manifest;
  } catch {
    return null;
  }
}

export function getMarkdownSignature(manifest: MarkdownManifest) {
  return hashContent(stringifyMarkdownManifest(manifest));
}

export function getKnowledgeIndexSignature(manifest: MarkdownManifest) {
  return `v2:${getEmbeddingConfig().signature}:${getMarkdownSignature(manifest)}`;
}

export function getEmbeddingSignatureFromKnowledgeIndexSignature(value: string | null) {
  const parts = value?.split(":");

  return parts?.[0] === "v2" && parts[1] ? parts[1] : null;
}

export function diffMarkdownManifests(previous: MarkdownManifest | null, current: MarkdownManifest) {
  const changedOrAdded = Object.entries(current)
    .filter(([relativePath, hash]) => previous?.[relativePath] !== hash)
    .map(([relativePath]) => relativePath);
  const removed = previous
    ? Object.keys(previous).filter((relativePath) => !(relativePath in current))
    : [];

  return { changedOrAdded, removed };
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

function sourceFileWhere(sourceId: number, relativePath: string): Where {
  return {
    $and: [
      { sourceId },
      { relativePath },
    ],
  };
}

export async function indexRepositoryMarkdown(input: {
  contextId: string;
  sourceId: number;
  repoFullName: string;
  clonePath: string;
  platform: "discord" | "slack";
  files?: ExtractedMarkdownFile[];
  changedOrAddedPaths?: string[];
  removedPaths?: string[];
  replaceSource?: boolean;
}) {
  const embeddingConfig = getEmbeddingConfig();
  const collectionName = getKnowledgeCollectionName(input.contextId, input.platform);
  const client = new ChromaClient({ host: chromaHost, port: chromaPort });
  const collection = await client.getOrCreateCollection({
    name: collectionName,
    metadata: {
      platform: input.platform,
      contextPlatform: input.platform,
      guildId: input.contextId,
      workspaceId: input.platform === "slack" ? input.contextId : "",
      ...embeddingConfig.metadata,
    },
    embeddingFunction: null,
  });
  const files = input.files ?? (await collectMarkdownFiles(input.clonePath));
  const allChunks = files.flatMap(chunkMarkdown);
  const changedOrAddedPaths = new Set(input.changedOrAddedPaths ?? files.map((file) => file.relativePath));
  const removedPaths = input.removedPaths ?? [];

  if (input.replaceSource) {
    await collection.delete({
      where: {
        sourceId: input.sourceId,
      },
    });
  } else {
    for (const relativePath of [...changedOrAddedPaths, ...removedPaths]) {
      await collection.delete({
        where: sourceFileWhere(input.sourceId, relativePath),
      });
    }
  }

  const chunksToEmbed = files
    .filter((file) => changedOrAddedPaths.has(file.relativePath))
    .flatMap(chunkMarkdown);

  for (let start = 0; start < chunksToEmbed.length; start += 16) {
    const batch = chunksToEmbed.slice(start, start + 16);

    if (batch.length === 0) {
      continue;
    }

    await collection.add({
      ids: batch.map((chunk) => `${input.sourceId}:${chunk.id}`),
      documents: batch.map((chunk) => chunk.text),
      embeddings: await embedTexts(batch.map((chunk) => chunk.text), "document"),
      metadatas: batch.map((chunk) => ({
        platform: "github",
        contextPlatform: input.platform,
        guildId: input.contextId,
        workspaceId: input.platform === "slack" ? input.contextId : "",
        sourceId: input.sourceId,
        repoFullName: input.repoFullName,
        relativePath: chunk.relativePath,
        chunkIndex: chunk.chunkIndex,
        ...embeddingConfig.metadata,
      })),
    });
  }

  return {
    collectionName,
    markdownFiles: files.length,
    chunks: allChunks.length,
    embeddedFiles: changedOrAddedPaths.size,
    embeddedChunks: chunksToEmbed.length,
  };
}
