import crypto from "node:crypto";
import { getLanguageModelSettingsUnsafe } from "./db.js";

type Pipeline = (input: string | string[], options?: Record<string, unknown>) => Promise<unknown>;

type EmbeddingConfig =
  | {
      provider: "openai";
      model: string;
      dimensions: number | null;
      apiKey: string;
      signature: string;
      metadata: Record<string, string>;
    }
  | {
      provider: "local";
      model: string;
      documentPrefix: string;
      queryPrefix: string;
      quantized: boolean;
      signature: string;
      metadata: Record<string, string>;
    };

type OpenAiEmbeddingResponse = {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
};

let embeddingPipeline: Promise<Pipeline> | null = null;

const localEmbeddingModel = "nomic-ai/nomic-embed-text-v1.5";
const localDocumentPrefix = "search_document";
const localQueryPrefix = "search_query";
const localEmbeddingQuantized = process.env.EMBEDDING_QUANTIZED !== "false";
const openAiEmbeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
const openAiEmbeddingDimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS);

function stableSignature(input: Record<string, string>) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))))
    .digest("hex")
    .slice(0, 16);
}

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || getLanguageModelSettingsUnsafe().openAiApiKey?.trim() || null;
}

export function getEmbeddingConfig(): EmbeddingConfig {
  const openAiApiKey = getOpenAiApiKey();

  if (openAiApiKey) {
    const dimensions = Number.isFinite(openAiEmbeddingDimensions) && openAiEmbeddingDimensions > 0
      ? Math.trunc(openAiEmbeddingDimensions)
      : null;
    const metadata = {
      embeddingProvider: "openai",
      embeddingModel: openAiEmbeddingModel,
      embeddingDimensions: dimensions ? String(dimensions) : "default",
    };

    return {
      provider: "openai",
      model: openAiEmbeddingModel,
      dimensions,
      apiKey: openAiApiKey,
      signature: stableSignature(metadata),
      metadata,
    };
  }

  const metadata = {
    embeddingProvider: "local",
    embeddingModel: localEmbeddingModel,
    embeddingPrefix: localDocumentPrefix,
    embeddingQuantized: String(localEmbeddingQuantized),
  };

  return {
    provider: "local",
    model: localEmbeddingModel,
    documentPrefix: localDocumentPrefix,
    queryPrefix: localQueryPrefix,
    quantized: localEmbeddingQuantized,
    signature: stableSignature(metadata),
    metadata,
  };
}

export function getKnowledgeCollectionName(contextId: string, platform: "discord" | "slack") {
  const base = platform === "slack" ? `slack_workspace_${contextId}` : `discord_guild_${contextId}`;
  return `${base}_${getEmbeddingConfig().signature}`;
}

async function getPipeline() {
  if (!embeddingPipeline) {
    embeddingPipeline = import("@xenova/transformers").then(async ({ env, pipeline }) => {
      env.allowLocalModels = true;
      return pipeline("feature-extraction", localEmbeddingModel, {
        quantized: localEmbeddingQuantized,
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

async function embedWithLocal(texts: string[], inputType: "document" | "query") {
  const config = getEmbeddingConfig();

  if (config.provider !== "local") {
    throw new Error("Local embedding config is not active.");
  }

  const extractor = await getPipeline();
  const prefix = inputType === "document" ? config.documentPrefix : config.queryPrefix;
  const embeddings: number[][] = [];

  for (const text of texts) {
    const output = await extractor(`${prefix}: ${text}`, {
      pooling: "mean",
      normalize: true,
    });
    embeddings.push(flattenEmbedding(output));
  }

  return embeddings;
}

async function embedWithOpenAi(texts: string[]) {
  const config = getEmbeddingConfig();

  if (config.provider !== "openai") {
    throw new Error("OpenAI embedding config is not active.");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      encoding_format: "float",
      ...(config.dimensions ? { dimensions: config.dimensions } : {}),
    }),
  });
  const data = (await response.json()) as OpenAiEmbeddingResponse;

  if (!response.ok) {
    throw new Error(data.error?.message ?? `OpenAI embeddings request failed with ${response.status}.`);
  }

  const embeddings = data.data
    ?.slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((item) => item.embedding);

  if (!embeddings || embeddings.length !== texts.length || embeddings.some((embedding) => !embedding)) {
    throw new Error("OpenAI embeddings response did not include one embedding per input.");
  }

  return embeddings as number[][];
}

export async function embedTexts(texts: string[], inputType: "document" | "query") {
  const sanitized = texts.map((text) => text.trim()).filter(Boolean);

  if (sanitized.length === 0) {
    return [];
  }

  const config = getEmbeddingConfig();
  return config.provider === "openai" ? embedWithOpenAi(sanitized) : embedWithLocal(sanitized, inputType);
}

export async function embedQuery(query: string) {
  const [embedding] = await embedTexts([query], "query");

  if (!embedding) {
    throw new Error("query is required.");
  }

  return embedding;
}
