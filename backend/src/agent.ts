import {
  cancelReminder,
  createReminder,
  getDiscordChannelHistory,
  getGuildKnowledgeSources,
  getLanguageModelSettingsUnsafe,
  getMcpToolSettings,
  resolveAgentConfig,
  updateReminder,
  type DiscordChannelMessage,
} from "./db.js";
import { searchDiscordGuildCode } from "./codeSearch.js";
import { searchGif } from "./mcp.js";
import { searchDiscordGuildKb } from "./vectorSearch.js";

export type AgentResponseInput = {
  input: string;
  source?: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
  authorId?: string;
  authorUsername?: string;
  authorDisplayName?: string;
  authorMention?: string;
  sentAt?: string;
};

export type AgentResponse = {
  provider: string;
  model: string;
  text: string;
};

type OpenAiResponse = {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type OpenAiInputMessage = {
  role: "user" | "assistant";
  content: string;
};

type OpenAiFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

type OpenAiInput = OpenAiInputMessage | OpenAiFunctionCallOutput;

type OpenAiInputTokensResponse = {
  input_tokens?: number;
  error?: {
    message?: string;
  };
};

type OpenAiTool = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  strict: boolean;
};

const defaultHistoryLimit = 20;
const maxToolRounds = Number(process.env.AGENT_MAX_TOOL_ROUNDS ?? 24);
const maxInputTokens = Number(process.env.AGENT_MAX_INPUT_TOKENS ?? 24_000);
const fallbackMaxInputChars = maxInputTokens * 4;

function extractOpenAiText(response: OpenAiResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const text = response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("")
    .trim();

  if (!text) {
    const outputTypes = response.output?.map((item) => item.type ?? "unknown").join(", ") || "none";
    throw new Error(`OpenAI response did not include output text. Output types: ${outputTypes}.`);
  }

  return text;
}

function hasOpenAiText(response: OpenAiResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return true;
  }

  return Boolean(
    response.output
      ?.flatMap((item) => item.content ?? [])
      .some((content) => content.type === "output_text" && typeof content.text === "string" && content.text.trim()),
  );
}

function getEnabledOpenAiTools(input: AgentResponseInput) {
  const settings = getMcpToolSettings();
  const tools: OpenAiTool[] = [];

  if (input.source === "discord" && input.guildId) {
    const knowledgeSources = getGuildKnowledgeSources(input.guildId);

    tools.push({
      type: "function",
      name: "discord_guild_kb",
      description:
        "Search this Discord guild's indexed knowledge base. Use this for questions about guild-specific docs, repositories, policies, project context, or saved knowledge sources.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused semantic search query for this guild's knowledge base.",
          },
          limit: {
            type: "integer",
            description: "Maximum number of knowledge chunks to return.",
            minimum: 1,
            maximum: 10,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      strict: false,
    });

    if (knowledgeSources.length > 0) {
      tools.push({
        type: "function",
        name: "discord_guild_code",
        description:
          "Search the cloned GitHub repositories configured as knowledge sources for this Discord guild. Use this when markdown KB results are insufficient, when the user asks about implementation details, or when exact code references are needed.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Exact code, identifier, function name, file name, or phrase to search for.",
            },
            repoFullName: {
              type: "string",
              description: "Optional GitHub repo full name to limit the search, like owner/repo.",
            },
            limit: {
              type: "integer",
              description: "Maximum number of matches to return.",
              minimum: 1,
              maximum: 50,
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        strict: false,
      });
    }

    tools.push(
      {
        type: "function",
        name: "set_reminder",
        description:
          "Create a reminder for the current conversation. For Discord, the reminder will be sent back to this same guild and channel and mention the requesting user.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short reminder title.",
            },
            remindAt: {
              type: "string",
              description:
                "Absolute ISO-8601 timestamp for when to send the reminder. Use the current timestamp from the prompt to resolve relative times.",
            },
            message: {
              type: "string",
              description: "Optional reminder body.",
            },
          },
          required: ["title", "remindAt"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "edit_reminder",
        description: "Edit an existing reminder by ID.",
        parameters: {
          type: "object",
          properties: {
            reminderId: {
              type: "integer",
              description: "Reminder ID.",
            },
            title: {
              type: "string",
              description: "New reminder title.",
            },
            remindAt: {
              type: "string",
              description: "New absolute ISO-8601 reminder time.",
            },
            message: {
              type: "string",
              description: "New reminder body.",
            },
          },
          required: ["reminderId"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "delete_reminder",
        description: "Cancel an existing reminder by ID.",
        parameters: {
          type: "object",
          properties: {
            reminderId: {
              type: "integer",
              description: "Reminder ID.",
            },
          },
          required: ["reminderId"],
          additionalProperties: false,
        },
        strict: false,
      },
    );
  }

  if (settings.gifSearch.enabled && settings.gifSearch.tenorApiKey) {
    tools.push({
      type: "function",
      name: "search_gif",
      description:
        "Search Tenor for GIFs. Use this when a GIF would make the response more expressive, funny, or useful. Return a selected GIF URL in the final response.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Short search phrase for the desired GIF.",
          },
          limit: {
            type: "integer",
            description: "Maximum number of GIF results to return.",
            minimum: 1,
            maximum: 20,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      strict: false,
    });
  }

  return tools;
}

function getFunctionCalls(response: OpenAiResponse) {
  return (
    response.output?.filter(
      (item): item is { type: string; call_id: string; name: string; arguments: string } =>
        item.type === "function_call" &&
        typeof item.call_id === "string" &&
        typeof item.name === "string" &&
        typeof item.arguments === "string",
    ) ?? []
  );
}

async function callTool(name: string, rawArguments: string, input: AgentResponseInput) {
  let args: unknown;

  try {
    args = JSON.parse(rawArguments);
  } catch {
    throw new Error(`Tool ${name} received invalid JSON arguments.`);
  }

  if (name === "search_gif") {
    const payload = args && typeof args === "object" ? (args as { query?: unknown; limit?: unknown }) : {};
    return searchGif({
      query: typeof payload.query === "string" ? payload.query : "",
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }

  if (name === "discord_guild_kb") {
    if (input.source !== "discord" || !input.guildId) {
      throw new Error("discord_guild_kb requires a Discord guild context.");
    }

    const payload = args && typeof args === "object" ? (args as { query?: unknown; limit?: unknown }) : {};
    return searchDiscordGuildKb({
      guildId: input.guildId,
      query: typeof payload.query === "string" ? payload.query : "",
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }

  if (name === "discord_guild_code") {
    if (input.source !== "discord" || !input.guildId) {
      throw new Error("discord_guild_code requires a Discord guild context.");
    }

    const payload =
      args && typeof args === "object"
        ? (args as { query?: unknown; repoFullName?: unknown; limit?: unknown })
        : {};
    return searchDiscordGuildCode({
      guildId: input.guildId,
      query: typeof payload.query === "string" ? payload.query : "",
      repoFullName: typeof payload.repoFullName === "string" ? payload.repoFullName : undefined,
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }

  if (name === "set_reminder") {
    if (!input.source) {
      throw new Error("set_reminder requires a platform context.");
    }

    const payload =
      args && typeof args === "object"
        ? (args as { title?: unknown; remindAt?: unknown; message?: unknown })
        : {};
    const remindAt = parseReminderTime(typeof payload.remindAt === "string" ? payload.remindAt : "");

    return createReminder({
      platform: input.source,
      guildId: input.guildId,
      channelId: input.channelId,
      authorId: input.authorId,
      authorMention: input.authorMention,
      title: typeof payload.title === "string" ? payload.title.trim() : "",
      message: typeof payload.message === "string" ? payload.message.trim() : undefined,
      remindAt,
    });
  }

  if (name === "edit_reminder") {
    const payload =
      args && typeof args === "object"
        ? (args as { reminderId?: unknown; title?: unknown; remindAt?: unknown; message?: unknown })
        : {};
    const reminderId = typeof payload.reminderId === "number" ? payload.reminderId : 0;

    if (!Number.isInteger(reminderId) || reminderId <= 0) {
      throw new Error("reminderId must be a positive integer.");
    }

    return updateReminder({
      id: reminderId,
      title: typeof payload.title === "string" ? payload.title : undefined,
      message: typeof payload.message === "string" ? payload.message : undefined,
      remindAt:
        typeof payload.remindAt === "string" && payload.remindAt.trim()
          ? parseReminderTime(payload.remindAt)
          : undefined,
    });
  }

  if (name === "delete_reminder") {
    const payload = args && typeof args === "object" ? (args as { reminderId?: unknown }) : {};
    const reminderId = typeof payload.reminderId === "number" ? payload.reminderId : 0;

    if (!Number.isInteger(reminderId) || reminderId <= 0) {
      throw new Error("reminderId must be a positive integer.");
    }

    return cancelReminder(reminderId);
  }

  throw new Error(`Unsupported tool: ${name}`);
}

function parseReminderTime(value: string) {
  const parsed = new Date(value);

  if (!value.trim() || Number.isNaN(parsed.getTime())) {
    throw new Error("remindAt must be an absolute ISO-8601 timestamp.");
  }

  return parsed.toISOString();
}

function formatDiscordHistoryMessage(message: DiscordChannelMessage) {
  const author =
    message.authorDisplayName && message.authorDisplayName !== message.authorUsername
      ? `${message.authorMention} (${message.authorDisplayName}, ${message.authorUsername})`
      : `${message.authorMention} (${message.authorUsername})`;

  return `- ${message.sentAt} | ${message.role} | ${author}: ${message.content}`;
}

function formatDiscordCurrentMessage(input: AgentResponseInput) {
  const mention = input.authorMention ?? (input.authorId ? `<@${input.authorId}>` : "Unknown user");
  const username = input.authorUsername ?? input.authorId ?? "unknown";
  const displayName =
    input.authorDisplayName && input.authorDisplayName !== username
      ? `${input.authorDisplayName}, ${username}`
      : username;
  const sentAt = input.sentAt ?? new Date().toISOString();

  return `Current Discord message from ${mention} (${displayName}) at ${sentAt}:\n${input.input}`;
}

function getDiscordInputMessages(input: AgentResponseInput) {
  if (input.source !== "discord" || !input.guildId || !input.channelId) {
    return [{ role: "user", content: input.input } satisfies OpenAiInputMessage];
  }

  const history = getDiscordChannelHistory({
    guildId: input.guildId,
    channelId: input.channelId,
    limit: defaultHistoryLimit,
  });

  if (history.length === 0) {
    return [
      {
        role: "user",
        content: formatDiscordCurrentMessage(input),
      },
    ] satisfies OpenAiInputMessage[];
  }

  const historyWithoutCurrent = input.messageId
    ? history.filter((message) => message.messageId !== input.messageId)
    : history;
  const transcript = historyWithoutCurrent.map(formatDiscordHistoryMessage).join("\n");

  return [
    {
      role: "user",
      content:
        "Discord channel context for memory only. Do not copy this transcript format in your reply. " +
        "Use mention tags only when naturally addressing someone.\n" +
        `${transcript || "No prior channel messages."}\n\n${formatDiscordCurrentMessage(input)}`,
    },
  ] satisfies OpenAiInputMessage[];
}

function totalInputChars(inputMessages: OpenAiInputMessage[], instructions: string) {
  return (
    instructions.length +
    inputMessages.reduce((total, message) => total + message.content.length, 0)
  );
}

async function getOpenAiInputTokens(input: {
  apiKey: string;
  model: string;
  instructions: string;
  inputMessages: OpenAiInputMessage[];
}) {
  const response = await fetch("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      instructions: input.instructions,
      input: input.inputMessages,
    }),
  });
  const data = (await response.json()) as OpenAiInputTokensResponse;

  if (!response.ok || typeof data.input_tokens !== "number") {
    throw new Error(data.error?.message ?? "Could not count OpenAI input tokens.");
  }

  return data.input_tokens;
}

async function trimInputMessages(input: {
  apiKey: string;
  model: string;
  instructions: string;
  inputMessages: OpenAiInputMessage[];
}) {
  const inputMessages = [...input.inputMessages];

  while (inputMessages.length > 1) {
    try {
      const inputTokens = await getOpenAiInputTokens({
        ...input,
        inputMessages,
      });

      if (inputTokens <= maxInputTokens) {
        return inputMessages;
      }

      inputMessages.shift();
    } catch {
      if (totalInputChars(inputMessages, input.instructions) <= fallbackMaxInputChars) {
        return inputMessages;
      }

      inputMessages.shift();
    }
  }

  return inputMessages;
}

async function generateOpenAiResponse(input: AgentResponseInput): Promise<AgentResponse> {
  const config = resolveAgentConfig(input);
  const languageModels = getLanguageModelSettingsUnsafe();
  const apiKey = languageModels.openAiApiKey;

  if (!apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const inputMessages = await trimInputMessages({
    apiKey,
    model: config.model,
    instructions: config.instructions,
    inputMessages: getDiscordInputMessages(input),
  });
  const tools = getEnabledOpenAiTools(input);

  const baseRequest = {
    model: config.model,
    instructions:
      tools.length > 0
        ? `${config.instructions}\n\nCurrent time: ${new Date().toISOString()}.\nDo not include channel-history transcript prefixes, timestamps, or speaker labels in your final answer. Reply naturally as Alshival. Use discord_guild_kb when guild-specific knowledge could help answer accurately. Use discord_guild_code when the user needs implementation details, exact code references, or the KB summary is not enough. Use reminder tools when the user asks you to remind them, edit a reminder, or delete a reminder. Reminder times must be absolute ISO-8601 timestamps. During casual Discord conversations, use GIFs often to express personality, reactions, humor, excitement, agreement, or encouragement. When you use a tool, use its result directly. For GIF results, include one selected GIF URL in your final answer when appropriate.`
        : `${config.instructions}\n\nCurrent time: ${new Date().toISOString()}.\nDo not include channel-history transcript prefixes, timestamps, or speaker labels in your final answer. Reply naturally as Alshival.`,
    tools,
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...baseRequest,
      input: inputMessages,
    }),
  });
  const data = (await response.json()) as OpenAiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message ?? "OpenAI response request failed.");
  }

  let currentResponse = data;

  for (let round = 0; round < maxToolRounds; round += 1) {
    const functionCalls = getFunctionCalls(currentResponse);

    if (functionCalls.length === 0) {
      break;
    }

    if (!currentResponse.id) {
      throw new Error("OpenAI tool call response did not include a response ID.");
    }

    const toolOutputs: OpenAiFunctionCallOutput[] = [];

    for (const functionCall of functionCalls) {
      try {
        const output = await callTool(functionCall.name, functionCall.arguments, input);
        toolOutputs.push({
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: JSON.stringify(output),
        });
      } catch (error) {
        toolOutputs.push({
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: JSON.stringify({
            error: error instanceof Error ? error.message : "Tool call failed.",
          }),
        });
      }
    }

    const followup = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...baseRequest,
        previous_response_id: currentResponse.id,
        input: toolOutputs satisfies OpenAiInput[],
      }),
    });
    const followupData = (await followup.json()) as OpenAiResponse;

    if (!followup.ok) {
      throw new Error(followupData.error?.message ?? "OpenAI tool follow-up request failed.");
    }

    currentResponse = followupData;
  }

  const unresolvedFunctionCalls = getFunctionCalls(currentResponse);
  if (unresolvedFunctionCalls.length > 0) {
    const names = unresolvedFunctionCalls.map((call) => call.name).join(", ");
    console.error(
      `OpenAI response still had ${unresolvedFunctionCalls.length} unresolved tool call(s) after ${maxToolRounds} rounds: ${names}.`,
    );

    return {
      provider: "openai",
      model: config.model,
      text: "I am sorry, I got tired trying to answer that question! Can you ask it again a little more specifically?",
    };
  }

  if (!hasOpenAiText(currentResponse) && currentResponse.id) {
    const finalResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...baseRequest,
        previous_response_id: currentResponse.id,
        input: [
          {
            role: "user",
            content: "Please provide the final Discord reply now, using the available tool results.",
          },
        ] satisfies OpenAiInputMessage[],
      }),
    });
    const finalData = (await finalResponse.json()) as OpenAiResponse;

    if (!finalResponse.ok) {
      throw new Error(finalData.error?.message ?? "OpenAI final response request failed.");
    }

    currentResponse = finalData;
  }

  return {
    provider: "openai",
    model: config.model,
    text: extractOpenAiText(currentResponse),
  };
}

export async function generateAgentResponse(input: AgentResponseInput): Promise<AgentResponse> {
  const config = resolveAgentConfig(input);

  if (!input.input.trim()) {
    throw new Error("Agent input is required.");
  }

  if (config.provider === "openai") {
    return generateOpenAiResponse(input);
  }

  throw new Error("Anthropic response generation is not implemented yet.");
}
