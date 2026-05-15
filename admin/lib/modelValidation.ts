import { getLanguageModelApiKey, type LanguageModelProvider } from "@/lib/db";

type OpenAiModelsResponse = {
  data?: Array<{ id?: string }>;
  error?: {
    message?: string;
  };
};

export async function validateModelId(provider: LanguageModelProvider, model: string) {
  const modelId = model.trim();

  if (!modelId) {
    throw new Error("Model ID is required.");
  }

  if (provider !== "openai") {
    return;
  }

  const apiKey = getLanguageModelApiKey("openai");

  if (!apiKey) {
    throw new Error("OpenAI API key is required before validating OpenAI model IDs.");
  }

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
  });
  const data = (await response.json()) as OpenAiModelsResponse;

  if (!response.ok) {
    throw new Error(data.error?.message ?? "Could not validate OpenAI model ID.");
  }

  if (!data.data?.some((candidate) => candidate.id === modelId)) {
    throw new Error(`OpenAI model ID "${modelId}" is not available for the saved API key.`);
  }
}
