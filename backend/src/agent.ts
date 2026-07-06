import {
  getDiscordChannelHistory,
  getAsanaChannelScope,
  createAsanaToolRun,
  getSlackChannelHistory,
  getGuildKnowledgeSources,
  getLanguageModelSettingsUnsafe,
  getMcpToolSettings,
  resolveAgentConfig,
  type DiscordChannelMessage,
  type SlackChannelMessage,
  type AsanaChannelScope,
} from "./db.js";
import {
  addAsanaDependency,
  addAsanaTaskComment,
  createAsanaTask,
  getAsanaAttachments,
  getAsanaBoard,
  getAsanaDependencies,
  getAsanaProjectStatus,
  getAsanaSubtasks,
  getAsanaTask,
  getAsanaTaskStories,
  listAsanaBoards,
  listAsanaProjectSections,
  listAsanaProjectTasks,
  listAsanaWorkspaceMembers,
  moveAsanaTaskToSection,
  removeAsanaDependency,
  searchAsanaProjectTasks,
  updateAsanaTask,
} from "./asana.js";
import { searchDiscordGuildCode, searchSlackWorkspaceCode } from "./codeSearch.js";
import { deleteReminder, editReminder, searchGif, setReminder } from "./mcp.js";
import { searchDiscordGuildKb, searchSlackWorkspaceKb } from "./vectorSearch.js";

export type AgentResponseInput = {
  input: string;
  attachments?: AgentAttachment[];
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

export type AgentAttachment = {
  name: string;
  mimeType: string;
  size: number;
  text?: string;
  imageDataUrl?: string;
  error?: string;
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
  content: string | OpenAiContentPart[];
};

type OpenAiContentPart =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail?: "auto" | "low" | "high";
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
  const asanaScope = getAsanaScopeForInput(input);

  if (input.source === "discord" && input.guildId) {
    const knowledgeSources = getGuildKnowledgeSources(input.guildId);

    tools.push({
      type: "function",
      name: "discord_guild_kb",
      description:
        "Search this Discord guild's indexed knowledge base. Use this for questions about guild-specific docs, repositories, policies, project context, or saved knowledge sources. When the user names or clearly implies a specific GitHub repo, pass repoFullName to limit semantic retrieval to that repo.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused semantic search query for this guild's knowledge base.",
          },
          repoFullName: {
            type: "string",
            description: "Optional GitHub repo full name to limit semantic search, like owner/repo.",
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

  if (input.source === "slack" && input.guildId) {
    const knowledgeSources = getGuildKnowledgeSources(input.guildId);

    tools.push({
      type: "function",
      name: "slack_workspace_kb",
      description:
        "Search this Slack workspace's indexed knowledge base. Use this for workspace-specific docs, repositories, policies, project context, or saved knowledge sources. When the user names or clearly implies a specific GitHub repo, pass repoFullName to limit semantic retrieval to that repo.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused semantic search query for this Slack workspace's knowledge base.",
          },
          repoFullName: {
            type: "string",
            description: "Optional GitHub repo full name to limit semantic search, like owner/repo.",
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
        name: "slack_workspace_code",
        description:
          "Search cloned GitHub repositories configured as knowledge sources for this Slack workspace. Use this when markdown KB results are insufficient, when implementation details are needed, or when exact code references are needed.",
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
          "Create a reminder for the current conversation. For Slack, the reminder will be sent back to this same workspace and channel and mention the requesting user.",
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

  if (settings.gifSearch.enabled && settings.gifSearch.klipyApiKey) {
    tools.push({
      type: "function",
      name: "search_gif",
      description:
        "Search KLIPY for GIFs. Use this when a GIF would make the response more expressive, funny, or useful. Return a selected GIF URL in the final response.",
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

  if (asanaScope) {
    tools.push(
      {
        type: "function",
        name: "asana_list_boards",
        description:
          "List Asana boards/projects available to this channel. For specific-board scopes this returns only the configured allowed boards.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_get_board",
        description:
          "Get Asana board/project metadata, including workspace and URL. The backend rejects board IDs this channel is not authorized to access.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Asana board/project GID.",
            },
          },
          required: ["boardId"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_list_workspace_members",
        description:
          "List Asana users in the workspace that owns the supplied authorized board. Use this to find assignee GIDs before assigning tasks.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Asana board/project GID.",
            },
            limit: {
              type: "integer",
              description: "Maximum number of users to return.",
              minimum: 1,
              maximum: 500,
            },
          },
          required: ["boardId"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_list_project_tasks",
        description:
          "List tasks from one Asana board/project. The backend rejects board IDs this channel is not authorized to access.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Asana board/project GID.",
            },
            includeCompleted: {
              type: "boolean",
              description: "Include completed tasks. Defaults to false.",
            },
            limit: {
              type: "integer",
              description: "Maximum number of tasks to return.",
              minimum: 1,
              maximum: 100,
            },
          },
          required: ["boardId"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_search_project_tasks",
        description:
          "Search task names and notes within one Asana board/project. The backend rejects board IDs this channel is not authorized to access.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Asana board/project GID.",
            },
            query: {
              type: "string",
              description: "Case-insensitive search text for task name or notes.",
            },
            includeCompleted: {
              type: "boolean",
              description: "Include completed tasks. Defaults to false.",
            },
            limit: {
              type: "integer",
              description: "Maximum number of matching tasks to return.",
              minimum: 1,
              maximum: 50,
            },
          },
          required: ["boardId", "query"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_get_task",
        description:
          "Get details for an Asana task and verify it belongs to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that should contain the task.",
            },
            taskGid: {
              type: "string",
              description: "Asana task GID.",
            },
          },
          required: ["boardId", "taskGid"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_get_task_stories",
        description:
          "List comments/stories for an Asana task after verifying the task belongs to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains the task.",
            },
            taskGid: {
              type: "string",
              description: "Asana task GID.",
            },
            limit: {
              type: "integer",
              description: "Maximum number of stories to return.",
              minimum: 1,
              maximum: 100,
            },
          },
          required: ["boardId", "taskGid"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_list_project_sections",
        description:
          "List sections/columns for one Asana board/project. The backend rejects board IDs this channel is not authorized to access.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Asana board/project GID.",
            },
          },
          required: ["boardId"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_get_project_status",
        description:
          "Get recent status updates for one Asana board/project. The backend rejects board IDs this channel is not authorized to access.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Asana board/project GID.",
            },
          },
          required: ["boardId"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_get_subtasks",
        description:
          "List subtasks for an Asana task after verifying the parent task belongs to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains the parent task.",
            },
            taskGid: {
              type: "string",
              description: "Parent Asana task GID.",
            },
          },
          required: ["boardId", "taskGid"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_get_dependencies",
        description:
          "List dependencies for an Asana task after verifying the task belongs to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains the task.",
            },
            taskGid: {
              type: "string",
              description: "Asana task GID.",
            },
          },
          required: ["boardId", "taskGid"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_get_attachments",
        description:
          "List attachments for an Asana task after verifying the task belongs to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains the task.",
            },
            taskGid: {
              type: "string",
              description: "Asana task GID.",
            },
          },
          required: ["boardId", "taskGid"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_create_task",
        description:
          "Create a task in one authorized Asana board/project. If sectionId is provided, the backend verifies the section belongs to the board before adding the task.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Asana board/project GID.",
            },
            name: {
              type: "string",
              description: "Task name.",
            },
            notes: {
              type: "string",
              description: "Optional task notes/body.",
            },
            dueOn: {
              type: "string",
              description: "Optional due date in YYYY-MM-DD format.",
            },
            assigneeGid: {
              type: "string",
              description: "Optional Asana user GID to assign the task to.",
            },
            sectionId: {
              type: "string",
              description: "Optional Asana section GID within the same board.",
            },
          },
          required: ["boardId", "name"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_update_task",
        description:
          "Update a task after verifying it belongs to the supplied authorized board. Blank assigneeGid clears the assignee; blank dueOn clears the due date.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains the task.",
            },
            taskGid: {
              type: "string",
              description: "Asana task GID.",
            },
            name: {
              type: "string",
              description: "New task name.",
            },
            notes: {
              type: "string",
              description: "New task notes/body.",
            },
            completed: {
              type: "boolean",
              description: "Set task completion state.",
            },
            dueOn: {
              type: "string",
              description: "Due date in YYYY-MM-DD format. Pass an empty string to clear.",
            },
            assigneeGid: {
              type: "string",
              description: "Asana user GID. Pass an empty string to unassign.",
            },
          },
          required: ["boardId", "taskGid"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_add_task_comment",
        description:
          "Add a comment to an Asana task after verifying the task belongs to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains the task.",
            },
            taskGid: {
              type: "string",
              description: "Asana task GID.",
            },
            text: {
              type: "string",
              description: "Comment text.",
            },
          },
          required: ["boardId", "taskGid", "text"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_move_task_to_section",
        description:
          "Move an Asana task into a section after verifying both the task and section belong to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains the task and section.",
            },
            taskGid: {
              type: "string",
              description: "Asana task GID.",
            },
            sectionId: {
              type: "string",
              description: "Asana section GID in the same board.",
            },
          },
          required: ["boardId", "taskGid", "sectionId"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_add_dependency",
        description:
          "Add an Asana dependency after verifying both the task and dependency task belong to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains both tasks.",
            },
            taskGid: {
              type: "string",
              description: "Task GID that depends on dependencyGid.",
            },
            dependencyGid: {
              type: "string",
              description: "Dependency task GID.",
            },
          },
          required: ["boardId", "taskGid", "dependencyGid"],
          additionalProperties: false,
        },
        strict: false,
      },
      {
        type: "function",
        name: "asana_remove_dependency",
        description:
          "Remove an Asana dependency after verifying both the task and dependency task belong to the supplied authorized board.",
        parameters: {
          type: "object",
          properties: {
            boardId: {
              type: "string",
              description: "Authorized Asana board/project GID that contains both tasks.",
            },
            taskGid: {
              type: "string",
              description: "Task GID.",
            },
            dependencyGid: {
              type: "string",
              description: "Dependency task GID to remove.",
            },
          },
          required: ["boardId", "taskGid", "dependencyGid"],
          additionalProperties: false,
        },
        strict: false,
      },
    );
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

  if (name === "asana_list_boards") {
    return callAuditedAsanaTool(input, name, {}, () => listAsanaBoards(getRequiredAsanaScope(input)));
  }

  if (name === "asana_get_board") {
    const payload = args && typeof args === "object" ? (args as { boardId?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";

    return callAuditedAsanaTool(input, name, { boardId }, () =>
      getAsanaBoard({
        scope: getRequiredAsanaScope(input),
        boardId,
      }),
    );
  }

  if (name === "asana_list_workspace_members") {
    const payload =
      args && typeof args === "object" ? (args as { boardId?: unknown; limit?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";

    return callAuditedAsanaTool(input, name, { boardId }, () =>
      listAsanaWorkspaceMembers({
        scope: getRequiredAsanaScope(input),
        boardId,
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
      }),
    );
  }

  if (name === "asana_list_project_tasks") {
    const payload =
      args && typeof args === "object"
        ? (args as { boardId?: unknown; includeCompleted?: unknown; limit?: unknown })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";

    return callAuditedAsanaTool(input, name, { boardId }, () =>
      listAsanaProjectTasks({
        scope: getRequiredAsanaScope(input),
        boardId,
        includeCompleted: payload.includeCompleted === true,
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
      }),
    );
  }

  if (name === "asana_search_project_tasks") {
    const payload =
      args && typeof args === "object"
        ? (args as { boardId?: unknown; query?: unknown; includeCompleted?: unknown; limit?: unknown })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";

    return callAuditedAsanaTool(input, name, { boardId }, () =>
      searchAsanaProjectTasks({
        scope: getRequiredAsanaScope(input),
        boardId,
        query: typeof payload.query === "string" ? payload.query : "",
        includeCompleted: payload.includeCompleted === true,
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
      }),
    );
  }

  if (name === "asana_get_task") {
    const payload = args && typeof args === "object" ? (args as { boardId?: unknown; taskGid?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      getAsanaTask({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
      }),
    );
  }

  if (name === "asana_get_task_stories") {
    const payload =
      args && typeof args === "object"
        ? (args as { boardId?: unknown; taskGid?: unknown; limit?: unknown })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      getAsanaTaskStories({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
      }),
    );
  }

  if (name === "asana_list_project_sections") {
    const payload = args && typeof args === "object" ? (args as { boardId?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";

    return callAuditedAsanaTool(input, name, { boardId }, () =>
      listAsanaProjectSections({
        scope: getRequiredAsanaScope(input),
        boardId,
      }),
    );
  }

  if (name === "asana_get_project_status") {
    const payload = args && typeof args === "object" ? (args as { boardId?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";

    return callAuditedAsanaTool(input, name, { boardId }, () =>
      getAsanaProjectStatus({
        scope: getRequiredAsanaScope(input),
        boardId,
      }),
    );
  }

  if (name === "asana_get_subtasks") {
    const payload = args && typeof args === "object" ? (args as { boardId?: unknown; taskGid?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      getAsanaSubtasks({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
      }),
    );
  }

  if (name === "asana_get_dependencies") {
    const payload = args && typeof args === "object" ? (args as { boardId?: unknown; taskGid?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      getAsanaDependencies({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
      }),
    );
  }

  if (name === "asana_get_attachments") {
    const payload = args && typeof args === "object" ? (args as { boardId?: unknown; taskGid?: unknown }) : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      getAsanaAttachments({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
      }),
    );
  }

  if (name === "asana_create_task") {
    const payload =
      args && typeof args === "object"
        ? (args as {
            boardId?: unknown;
            name?: unknown;
            notes?: unknown;
            dueOn?: unknown;
            assigneeGid?: unknown;
            sectionId?: unknown;
          })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";

    return callAuditedAsanaTool(input, name, { boardId }, () =>
      createAsanaTask({
        scope: getRequiredAsanaScope(input),
        boardId,
        name: typeof payload.name === "string" ? payload.name : "",
        notes: typeof payload.notes === "string" ? payload.notes : undefined,
        dueOn: typeof payload.dueOn === "string" ? payload.dueOn : undefined,
        assigneeGid: typeof payload.assigneeGid === "string" ? payload.assigneeGid : undefined,
        sectionId: typeof payload.sectionId === "string" ? payload.sectionId : undefined,
      }),
    );
  }

  if (name === "asana_update_task") {
    const payload =
      args && typeof args === "object"
        ? (args as {
            boardId?: unknown;
            taskGid?: unknown;
            name?: unknown;
            notes?: unknown;
            completed?: unknown;
            dueOn?: unknown;
            assigneeGid?: unknown;
          })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      updateAsanaTask({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
        name: typeof payload.name === "string" ? payload.name : undefined,
        notes: typeof payload.notes === "string" ? payload.notes : undefined,
        completed: typeof payload.completed === "boolean" ? payload.completed : undefined,
        dueOn: typeof payload.dueOn === "string" ? payload.dueOn : undefined,
        assigneeGid: typeof payload.assigneeGid === "string" ? payload.assigneeGid : undefined,
      }),
    );
  }

  if (name === "asana_add_task_comment") {
    const payload =
      args && typeof args === "object"
        ? (args as { boardId?: unknown; taskGid?: unknown; text?: unknown })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      addAsanaTaskComment({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
        text: typeof payload.text === "string" ? payload.text : "",
      }),
    );
  }

  if (name === "asana_move_task_to_section") {
    const payload =
      args && typeof args === "object"
        ? (args as { boardId?: unknown; taskGid?: unknown; sectionId?: unknown })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      moveAsanaTaskToSection({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
        sectionId: typeof payload.sectionId === "string" ? payload.sectionId : "",
      }),
    );
  }

  if (name === "asana_add_dependency") {
    const payload =
      args && typeof args === "object"
        ? (args as { boardId?: unknown; taskGid?: unknown; dependencyGid?: unknown })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      addAsanaDependency({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
        dependencyGid: typeof payload.dependencyGid === "string" ? payload.dependencyGid : "",
      }),
    );
  }

  if (name === "asana_remove_dependency") {
    const payload =
      args && typeof args === "object"
        ? (args as { boardId?: unknown; taskGid?: unknown; dependencyGid?: unknown })
        : {};
    const boardId = typeof payload.boardId === "string" ? payload.boardId : "";
    const taskGid = typeof payload.taskGid === "string" ? payload.taskGid : "";

    return callAuditedAsanaTool(input, name, { boardId, taskGid }, () =>
      removeAsanaDependency({
        scope: getRequiredAsanaScope(input),
        boardId,
        taskGid,
        dependencyGid: typeof payload.dependencyGid === "string" ? payload.dependencyGid : "",
      }),
    );
  }

  if (name === "discord_guild_kb") {
    if (input.source !== "discord" || !input.guildId) {
      throw new Error("discord_guild_kb requires a Discord guild context.");
    }

    const payload =
      args && typeof args === "object"
        ? (args as { query?: unknown; repoFullName?: unknown; limit?: unknown })
        : {};
    return searchDiscordGuildKb({
      guildId: input.guildId,
      query: typeof payload.query === "string" ? payload.query : "",
      repoFullName: typeof payload.repoFullName === "string" ? payload.repoFullName : undefined,
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

  if (name === "slack_workspace_kb") {
    if (input.source !== "slack" || !input.guildId) {
      throw new Error("slack_workspace_kb requires a Slack workspace context.");
    }

    const payload =
      args && typeof args === "object"
        ? (args as { query?: unknown; repoFullName?: unknown; limit?: unknown })
        : {};
    return searchSlackWorkspaceKb({
      workspaceId: input.guildId,
      query: typeof payload.query === "string" ? payload.query : "",
      repoFullName: typeof payload.repoFullName === "string" ? payload.repoFullName : undefined,
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }

  if (name === "slack_workspace_code") {
    if (input.source !== "slack" || !input.guildId) {
      throw new Error("slack_workspace_code requires a Slack workspace context.");
    }

    const payload =
      args && typeof args === "object"
        ? (args as { query?: unknown; repoFullName?: unknown; limit?: unknown })
        : {};
    return searchSlackWorkspaceCode({
      workspaceId: input.guildId,
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

    return (
      await setReminder({
        platform: input.source,
        guildId: input.guildId,
        channelId: input.channelId,
        authorId: input.authorId,
        authorMention: input.authorMention,
        title: typeof payload.title === "string" ? payload.title.trim() : "",
        message: typeof payload.message === "string" ? payload.message.trim() : undefined,
        remindAt,
      })
    ).reminder;
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

    return (
      await editReminder({
        id: reminderId,
        title: typeof payload.title === "string" ? payload.title : undefined,
        message: typeof payload.message === "string" ? payload.message : undefined,
        remindAt:
          typeof payload.remindAt === "string" && payload.remindAt.trim()
            ? parseReminderTime(payload.remindAt)
            : undefined,
      })
    ).reminder;
  }

  if (name === "delete_reminder") {
    const payload = args && typeof args === "object" ? (args as { reminderId?: unknown }) : {};
    const reminderId = typeof payload.reminderId === "number" ? payload.reminderId : 0;

    if (!Number.isInteger(reminderId) || reminderId <= 0) {
      throw new Error("reminderId must be a positive integer.");
    }

    return (await deleteReminder({ id: reminderId })).reminder;
  }

  throw new Error(`Unsupported tool: ${name}`);
}

function getAsanaScopeForInput(input: AgentResponseInput) {
  if (
    (input.source !== "discord" && input.source !== "slack") ||
    !input.guildId ||
    !input.channelId
  ) {
    return null;
  }

  return getAsanaChannelScope({
    platform: input.source,
    contextId: input.guildId,
    channelId: input.channelId,
  });
}

function getRequiredAsanaScope(input: AgentResponseInput) {
  const scope = getAsanaScopeForInput(input);

  if (!scope) {
    throw new Error("Asana is not enabled for this channel.");
  }

  return scope;
}

async function callAuditedAsanaTool<T>(
  input: AgentResponseInput,
  toolName: string,
  target: {
    boardId?: string;
    taskGid?: string;
  },
  operation: () => Promise<T>,
) {
  const platform = input.source === "discord" || input.source === "slack" ? input.source : null;

  try {
    const result = await operation();

    if (platform && input.guildId && input.channelId) {
      createAsanaToolRun({
        platform,
        contextId: input.guildId,
        channelId: input.channelId,
        authorId: input.authorId,
        authorMention: input.authorMention,
        toolName,
        boardId: target.boardId,
        taskGid: target.taskGid,
        success: true,
      });
    }

    return result;
  } catch (error) {
    if (platform && input.guildId && input.channelId) {
      createAsanaToolRun({
        platform,
        contextId: input.guildId,
        channelId: input.channelId,
        authorId: input.authorId,
        authorMention: input.authorMention,
        toolName,
        boardId: target.boardId,
        taskGid: target.taskGid,
        success: false,
        error: error instanceof Error ? error.message : "Unknown Asana tool error.",
      });
    }

    throw error;
  }
}

function describeAsanaScope(scope: AsanaChannelScope) {
  if (scope.mode === "all") {
    return "This channel has access to all configured Asana boards.";
  }

  const boards = scope.boards
    .map((board) => {
      const name = board.boardName ? `${board.boardName} ` : "";
      const workspace = board.workspaceName ? ` in ${board.workspaceName}` : "";
      return `- ${name}(${board.boardId})${workspace}`;
    })
    .join("\n");

  return [
    "This channel is restricted to these Asana boards only:",
    boards || "- No boards configured.",
    "Do not answer Asana questions from any other board. If the requested board is not listed, say this channel is not authorized for that board.",
  ].join("\n");
}

function parseReminderTime(value: string) {
  const parsed = new Date(value);

  if (!value.trim() || Number.isNaN(parsed.getTime())) {
    throw new Error("remindAt must be an absolute ISO-8601 timestamp.");
  }

  return parsed.toISOString();
}

function formatAttachmentContext(input: AgentResponseInput) {
  const attachments = input.attachments ?? [];

  if (attachments.length === 0) {
    return "";
  }

  const sections = attachments.map((attachment, index) => {
    const header = [
      `Attachment ${index + 1}: ${attachment.name}`,
      attachment.mimeType ? `type=${attachment.mimeType}` : null,
      attachment.size ? `bytes=${attachment.size}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    if (attachment.error) {
      return `${header}\nCould not read attachment: ${attachment.error}`;
    }

    if (attachment.text?.trim()) {
      return `${header}\n${attachment.text.trim()}`;
    }

    if (attachment.imageDataUrl) {
      return `${header}\nImage included as visual context.`;
    }

    return `${header}\nNo readable text extracted.`;
  });

  return `\n\nAdditional Slack context from files and links:\n${sections.join("\n\n")}`;
}

function withAttachmentContent(text: string, input: AgentResponseInput): string | OpenAiContentPart[] {
  const attachmentContext = formatAttachmentContext(input);
  const fullText = `${text}${attachmentContext}`;
  const imageParts = (input.attachments ?? [])
    .filter((attachment) => attachment.imageDataUrl)
    .map(
      (attachment): OpenAiContentPart => ({
        type: "input_image",
        image_url: attachment.imageDataUrl ?? "",
        detail: "auto",
      }),
    );

  if (imageParts.length === 0) {
    return fullText;
  }

  return [{ type: "input_text", text: fullText }, ...imageParts];
}

function openAiContentTextLength(content: OpenAiInputMessage["content"]) {
  if (typeof content === "string") {
    return content.length;
  }

  return content.reduce(
    (total, part) =>
      total + (part.type === "input_text" ? part.text.length : Math.min(part.image_url.length, 2048)),
    0,
  );
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

function formatSlackHistoryMessage(message: SlackChannelMessage) {
  const author =
    message.authorDisplayName && message.authorDisplayName !== message.authorUsername
      ? `${message.authorMention} (${message.authorDisplayName}, ${message.authorUsername})`
      : `${message.authorMention} (${message.authorUsername})`;

  return `- ${message.sentAt} | ${message.role} | ${author}: ${message.content}`;
}

function formatSlackCurrentMessage(input: AgentResponseInput) {
  const mention = input.authorMention ?? (input.authorId ? `<@${input.authorId}>` : "Unknown user");
  const username = input.authorUsername ?? input.authorId ?? "unknown";
  const displayName =
    input.authorDisplayName && input.authorDisplayName !== username
      ? `${input.authorDisplayName}, ${username}`
      : username;
  const sentAt = input.sentAt ?? new Date().toISOString();

  return `Current Slack message from ${mention} (${displayName}) at ${sentAt}:\n${input.input}`;
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

function getSlackInputMessages(input: AgentResponseInput) {
  if (input.source !== "slack" || !input.guildId || !input.channelId) {
    return [{ role: "user", content: input.input } satisfies OpenAiInputMessage];
  }

  const history = getSlackChannelHistory({
    workspaceId: input.guildId,
    channelId: input.channelId,
    limit: defaultHistoryLimit,
  });

  if (history.length === 0) {
    return [
      {
        role: "user",
        content: withAttachmentContent(formatSlackCurrentMessage(input), input),
      },
    ] satisfies OpenAiInputMessage[];
  }

  const historyWithoutCurrent = input.messageId
    ? history.filter((message) => message.messageId !== input.messageId)
    : history;
  const transcript = historyWithoutCurrent.map(formatSlackHistoryMessage).join("\n");

  return [
    {
      role: "user",
      content: withAttachmentContent(
        "Slack channel context for memory only. Do not copy this transcript format in your reply. " +
          "Use Slack mention tags only when naturally addressing someone.\n" +
          `${transcript || "No prior channel messages."}\n\n${formatSlackCurrentMessage(input)}`,
        input,
      ),
    },
  ] satisfies OpenAiInputMessage[];
}

function getInputMessages(input: AgentResponseInput) {
  if (input.source === "discord") {
    return getDiscordInputMessages(input);
  }

  if (input.source === "slack") {
    return getSlackInputMessages(input);
  }

  return [{ role: "user", content: input.input } satisfies OpenAiInputMessage];
}

function totalInputChars(inputMessages: OpenAiInputMessage[], instructions: string) {
  return (
    instructions.length +
    inputMessages.reduce((total, message) => total + openAiContentTextLength(message.content), 0)
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
    inputMessages: getInputMessages(input),
  });
  const tools = getEnabledOpenAiTools(input);
  const asanaScope = getAsanaScopeForInput(input);
  const asanaInstructions = asanaScope
    ? `\n\nAsana channel access:\n${describeAsanaScope(asanaScope)}\nUse the Asana tools for Asana facts and actions. Start with asana_list_boards if you need board IDs, asana_list_project_sections if you need section IDs, and asana_list_workspace_members if you need assignee GIDs. Execute Asana writes immediately when the user's instruction is clear, and report the resulting task, comment, status, URL, or GID. Do not answer Asana board-specific questions from memory when this channel has an Asana scope.`
    : "";

  const baseRequest = {
    model: config.model,
    instructions:
      tools.length > 0
        ? `${config.instructions}\n\nCurrent time: ${new Date().toISOString()}.\nDo not include channel-history transcript prefixes, timestamps, or speaker labels in your final answer. Reply naturally as Alshival. Use platform-specific knowledge base tools when workspace or guild knowledge could help answer accurately. Use platform-specific code search tools when the user needs implementation details, exact code references, or the KB summary is not enough. Use reminder tools when the user asks you to remind them, edit a reminder, or delete a reminder. Reminder times must be absolute ISO-8601 timestamps. During casual Discord or Slack conversations, use GIFs often to express personality, reactions, humor, excitement, agreement, or encouragement. When you use a tool, use its result directly. For GIF results, include one selected KLIPY GIF URL from the search_gif tool in your final answer when appropriate. Never include Giphy, Tenor, or invented GIF URLs.${asanaInstructions}`
        : `${config.instructions}\n\nCurrent time: ${new Date().toISOString()}.\nDo not include channel-history transcript prefixes, timestamps, or speaker labels in your final answer. Reply naturally as Alshival.${asanaInstructions}`,
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
            content: "Please provide the final platform reply now, using the available tool results.",
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

  if (!input.input.trim() && !input.attachments?.length) {
    throw new Error("Agent input is required.");
  }

  if (config.provider === "openai") {
    return generateOpenAiResponse(input);
  }

  throw new Error("Anthropic response generation is not implemented yet.");
}
