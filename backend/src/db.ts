import Database from "better-sqlite3";
import path from "node:path";

export type PlatformSettingsRow = {
  platform: string;
  bot_token: string | null;
  app_token: string | null;
  enabled: 0 | 1;
  desired_running: 0 | 1;
  updated_at: string | null;
};

export type LanguageModelProvider = "openai" | "anthropic";

export type AgentConfig = {
  provider: LanguageModelProvider;
  model: string;
  instructions: string;
  updatedAt: string | null;
};

export type LanguageModelSettings = {
  provider: LanguageModelProvider;
  openAiApiKey: string | null;
  anthropicApiKey: string | null;
  updatedAt: string | null;
};

export type DiscordChannelMessageRole = "user" | "assistant";

export type DiscordChannelMessage = {
  guildId: string;
  channelId: string;
  messageId: string;
  role: DiscordChannelMessageRole;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorMention: string;
  content: string;
  sentAt: string;
  createdAt: string;
};

export type SlackChannelMessageRole = "user" | "assistant";

export type SlackChannelMessage = {
  workspaceId: string;
  channelId: string;
  messageId: string;
  role: SlackChannelMessageRole;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorMention: string;
  content: string;
  sentAt: string;
  createdAt: string;
};

export type SlackWorkspaceSettingsRow = {
  workspace_id: string;
  workspace_name: string | null;
  workspace_domain: string | null;
  bot_token: string | null;
  app_token: string | null;
  enabled: 0 | 1;
  desired_running: 0 | 1;
  bot_user_id: string | null;
  bot_name: string | null;
  created_at: string;
  updated_at: string;
};

export type McpToolSettings = {
  gifSearch: {
    enabled: boolean;
    klipyApiKey: string | null;
    queryPrefix: string;
    defaultLimit: number;
    updatedAt: string | null;
  };
};

export type AsanaBoardScope = {
  boardId: string;
  boardName: string | null;
  workspaceName: string | null;
};

export type AsanaChannelScopeMode = "all" | "specific";

export type AsanaChannelScope = {
  id: number;
  platform: "discord" | "slack";
  contextId: string;
  channelId: string;
  channelName: string | null;
  mode: AsanaChannelScopeMode;
  boards: AsanaBoardScope[];
  createdAt: string;
  updatedAt: string;
};

export type AsanaMcpSettings = {
  clientId: string;
  clientSecret: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  authorizedUserGid: string | null;
  authorizedUserName: string | null;
  authorizedUserEmail: string | null;
  mcpServerUrl: string;
  resourceUrl: string;
  authorizationUrl: string;
  updatedAt: string | null;
};

export type CreateAsanaToolRunInput = {
  platform: "discord" | "slack";
  contextId: string;
  channelId: string;
  authorId?: string | null;
  authorMention?: string | null;
  toolName: string;
  boardId?: string | null;
  taskGid?: string | null;
  success: boolean;
  error?: string | null;
};

export type GuildKnowledgeSource = {
  id: number;
  guildId: string;
  repoFullName: string;
  repoSshUrl: string;
  repoHtmlUrl: string;
  clonePath: string;
  vectorCollection: string | null;
  indexedAt: string | null;
  indexedMarkdownFiles: number;
  indexedChunks: number;
  markdownSignature: string | null;
  markdownManifest: string | null;
};

export type GithubSshKeyMetadata = {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  fingerprint: string;
  updatedAt: string;
};

export type ReminderStatus = "pending" | "sending" | "sent" | "cancelled";

export type Reminder = {
  id: number;
  platform: string;
  guildId: string | null;
  channelId: string | null;
  authorId: string | null;
  authorMention: string | null;
  title: string;
  message: string | null;
  remindAt: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

const dbPath = process.env.BOT_DB_PATH ?? path.resolve(process.cwd(), "..", "bot.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS platform_settings (
    platform TEXT PRIMARY KEY,
    bot_token TEXT,
    app_token TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    desired_running INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS discord_channel_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_username TEXT NOT NULL,
    author_display_name TEXT NOT NULL,
    author_mention TEXT NOT NULL,
    content TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS slack_channel_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_username TEXT NOT NULL,
    author_display_name TEXT NOT NULL,
    author_mention TEXT NOT NULL,
    content TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS slack_workspace_settings (
    workspace_id TEXT PRIMARY KEY,
    workspace_name TEXT,
    workspace_domain TEXT,
    bot_token TEXT,
    app_token TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    desired_running INTEGER NOT NULL DEFAULT 0,
    bot_user_id TEXT,
    bot_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS asana_channel_scopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    context_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    access_mode TEXT NOT NULL,
    boards_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, context_id, channel_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS asana_tool_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    context_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    author_id TEXT,
    author_mention TEXT,
    tool_name TEXT NOT NULL,
    board_id TEXT,
    task_gid TEXT,
    success INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_asana_tool_runs_context_created
  ON asana_tool_runs (platform, context_id, channel_id, created_at)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_discord_channel_messages_channel_sent
  ON discord_channel_messages (guild_id, channel_id, sent_at, id)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_slack_channel_messages_channel_sent
  ON slack_channel_messages (workspace_id, channel_id, sent_at, id)
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_knowledge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    repo_full_name TEXT NOT NULL,
    repo_ssh_url TEXT NOT NULL,
    repo_html_url TEXT NOT NULL,
    clone_path TEXT NOT NULL DEFAULT '',
    vector_collection TEXT,
    indexed_at TEXT,
    indexed_markdown_files INTEGER NOT NULL DEFAULT 0,
    indexed_chunks INTEGER NOT NULL DEFAULT 0,
    private INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(guild_id, platform, repo_full_name)
  )
`);

const guildKnowledgeColumns = db
  .prepare("PRAGMA table_info(guild_knowledge_sources)")
  .all() as Array<{ name: string }>;
if (!guildKnowledgeColumns.some((column) => column.name === "clone_path")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN clone_path TEXT NOT NULL DEFAULT ''");
}
if (!guildKnowledgeColumns.some((column) => column.name === "vector_collection")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN vector_collection TEXT");
}
if (!guildKnowledgeColumns.some((column) => column.name === "indexed_at")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN indexed_at TEXT");
}
if (!guildKnowledgeColumns.some((column) => column.name === "indexed_markdown_files")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN indexed_markdown_files INTEGER NOT NULL DEFAULT 0");
}
if (!guildKnowledgeColumns.some((column) => column.name === "indexed_chunks")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN indexed_chunks INTEGER NOT NULL DEFAULT 0");
}
if (!guildKnowledgeColumns.some((column) => column.name === "markdown_signature")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN markdown_signature TEXT");
}
if (!guildKnowledgeColumns.some((column) => column.name === "markdown_manifest")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN markdown_manifest TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT,
    author_id TEXT,
    author_mention TEXT,
    title TEXT NOT NULL,
    message TEXT,
    remind_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders (status, remind_at)
`);

const columns = db.prepare("PRAGMA table_info(platform_settings)").all() as Array<{ name: string }>;
if (!columns.some((column) => column.name === "desired_running")) {
  db.exec("ALTER TABLE platform_settings ADD COLUMN desired_running INTEGER NOT NULL DEFAULT 0");
}
if (!columns.some((column) => column.name === "app_token")) {
  db.exec("ALTER TABLE platform_settings ADD COLUMN app_token TEXT");
}

function isLanguageModelProvider(value: unknown): value is LanguageModelProvider {
  return value === "openai" || value === "anthropic";
}

type ReminderRow = {
  id: number;
  platform: string;
  guild_id: string | null;
  channel_id: string | null;
  author_id: string | null;
  author_mention: string | null;
  title: string;
  message: string | null;
  remind_at: string;
  status: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    platform: row.platform,
    guildId: row.guild_id,
    channelId: row.channel_id,
    authorId: row.author_id,
    authorMention: row.author_mention,
    title: row.title,
    message: row.message,
    remindAt: row.remind_at,
    status:
      row.status === "sending" || row.status === "sent" || row.status === "cancelled"
        ? row.status
        : "pending",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

export function getPlatformSettings(platform: string) {
  return db
    .prepare(
      "SELECT platform, bot_token, app_token, enabled, desired_running, updated_at FROM platform_settings WHERE platform = ?",
    )
    .get(platform) as PlatformSettingsRow | undefined;
}

export function setDesiredRunning(platform: string, desiredRunning: boolean) {
  db.prepare(
    `
      INSERT INTO platform_settings (platform, desired_running, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        desired_running = excluded.desired_running,
        updated_at = excluded.updated_at
    `,
  ).run(platform, desiredRunning ? 1 : 0, new Date().toISOString());
}

export function getSlackWorkspaceSettings() {
  return db
    .prepare(
      `
        SELECT workspace_id, workspace_name, workspace_domain, bot_token, app_token, enabled, desired_running, bot_user_id, bot_name, created_at, updated_at
        FROM slack_workspace_settings
        ORDER BY workspace_name COLLATE NOCASE, workspace_id
      `,
    )
    .all() as SlackWorkspaceSettingsRow[];
}

export function getSlackWorkspaceSetting(workspaceId: string) {
  return db
    .prepare(
      `
        SELECT workspace_id, workspace_name, workspace_domain, bot_token, app_token, enabled, desired_running, bot_user_id, bot_name, created_at, updated_at
        FROM slack_workspace_settings
        WHERE workspace_id = ?
      `,
    )
    .get(workspaceId) as SlackWorkspaceSettingsRow | undefined;
}

export function saveSlackWorkspaceSetting(input: {
  workspaceId: string;
  workspaceName?: string | null;
  workspaceDomain?: string | null;
  botToken: string;
  appToken: string;
  enabled: boolean;
  desiredRunning?: boolean;
  botUserId?: string | null;
  botName?: string | null;
}) {
  const existing = getSlackWorkspaceSetting(input.workspaceId);
  const now = new Date().toISOString();
  const botToken = input.botToken.trim() || existing?.bot_token || null;
  const appToken = input.appToken.trim() || existing?.app_token || null;
  const desiredRunning = input.desiredRunning ?? Boolean(existing?.desired_running);

  db.prepare(
    `
      INSERT INTO slack_workspace_settings (
        workspace_id,
        workspace_name,
        workspace_domain,
        bot_token,
        app_token,
        enabled,
        desired_running,
        bot_user_id,
        bot_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        workspace_name = excluded.workspace_name,
        workspace_domain = excluded.workspace_domain,
        bot_token = excluded.bot_token,
        app_token = excluded.app_token,
        enabled = excluded.enabled,
        desired_running = excluded.desired_running,
        bot_user_id = excluded.bot_user_id,
        bot_name = excluded.bot_name,
        updated_at = excluded.updated_at
    `,
  ).run(
    input.workspaceId,
    input.workspaceName ?? existing?.workspace_name ?? null,
    input.workspaceDomain ?? existing?.workspace_domain ?? null,
    botToken,
    appToken,
    input.enabled ? 1 : 0,
    desiredRunning ? 1 : 0,
    input.botUserId ?? existing?.bot_user_id ?? null,
    input.botName ?? existing?.bot_name ?? null,
    existing?.created_at ?? now,
    now,
  );

  return getSlackWorkspaceSetting(input.workspaceId);
}

export function setSlackWorkspaceDesiredRunning(workspaceId: string, desiredRunning: boolean) {
  db.prepare(
    `
      UPDATE slack_workspace_settings
      SET desired_running = ?, updated_at = ?
      WHERE workspace_id = ?
    `,
  ).run(desiredRunning ? 1 : 0, new Date().toISOString(), workspaceId);

  return getSlackWorkspaceSetting(workspaceId);
}

export function deleteSlackWorkspaceSetting(workspaceId: string) {
  db.prepare("DELETE FROM slack_workspace_settings WHERE workspace_id = ?").run(workspaceId);
  return getSlackWorkspaceSettings();
}

function getAgentConfigByKey(key: string, fallback?: AgentConfig): AgentConfig {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;

  if (!row) {
    return fallback ?? {
      provider: "openai",
      model: "gpt-5.5",
      instructions: "You are Alshival, a helpful AI agent.",
      updatedAt: null,
    };
  }

  const parsed = JSON.parse(row.value) as Partial<AgentConfig>;

  return {
    provider: isLanguageModelProvider(parsed.provider) ? parsed.provider : "openai",
    model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : "gpt-5.5",
    instructions:
      typeof parsed.instructions === "string" && parsed.instructions.trim()
        ? parsed.instructions.trim()
        : "You are Alshival, a helpful AI agent.",
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
  };
}

export function getAgentConfig() {
  return getAgentConfigByKey("agent_config");
}

export function resolveAgentConfig(input?: { source?: string; guildId?: string }) {
  const defaultConfig = getAgentConfig();

  if (input?.source === "discord" && input.guildId) {
    return getAgentConfigByKey(`discord_guild_agent_config:${input.guildId}`, defaultConfig);
  }

  if (input?.source === "slack" && input.guildId) {
    return getAgentConfigByKey(`slack_workspace_agent_config:${input.guildId}`, defaultConfig);
  }

  return defaultConfig;
}

export function getLanguageModelSettingsUnsafe(): LanguageModelSettings {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get("language_models") as { value: string } | undefined;

  if (!row) {
    return {
      provider: "openai",
      openAiApiKey: null,
      anthropicApiKey: null,
      updatedAt: null,
    };
  }

  const parsed = JSON.parse(row.value) as Partial<LanguageModelSettings>;

  return {
    provider: isLanguageModelProvider(parsed.provider) ? parsed.provider : "openai",
    openAiApiKey: typeof parsed.openAiApiKey === "string" ? parsed.openAiApiKey : null,
    anthropicApiKey: typeof parsed.anthropicApiKey === "string" ? parsed.anthropicApiKey : null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
  };
}

export function getMcpToolSettings(): McpToolSettings {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get("mcp_tools") as { value: string } | undefined;

  if (!row) {
    return {
      gifSearch: {
        enabled: false,
        klipyApiKey: null,
        queryPrefix: "",
        defaultLimit: 8,
        updatedAt: null,
      },
    };
  }

  const parsed = JSON.parse(row.value) as Partial<McpToolSettings>;
  const gifSearch = parsed.gifSearch ?? {
    enabled: false,
    klipyApiKey: null,
    queryPrefix: "",
    defaultLimit: 8,
    updatedAt: null,
  };
  const klipyApiKey =
    typeof gifSearch.klipyApiKey === "string" && gifSearch.klipyApiKey.trim()
      ? gifSearch.klipyApiKey
      : null;

  return {
    gifSearch: {
      enabled: Boolean(gifSearch.enabled),
      klipyApiKey,
      queryPrefix:
        typeof gifSearch.queryPrefix === "string" ? gifSearch.queryPrefix.trim() : "",
      defaultLimit:
        typeof gifSearch.defaultLimit === "number" && Number.isFinite(gifSearch.defaultLimit)
          ? Math.max(1, Math.min(Math.trunc(gifSearch.defaultLimit), 20))
          : 8,
      updatedAt: typeof gifSearch.updatedAt === "string" ? gifSearch.updatedAt : null,
    },
  };
}

const asanaMcpDefaults = {
  mcpServerUrl: "https://mcp.asana.com/v2/mcp",
  resourceUrl: "https://mcp.asana.com/v2",
  authorizationUrl: "https://app.asana.com/-/oauth_authorize",
};
const asanaMcpSetting = "asana_mcp_settings";

function normalizeAsanaMcpSettings(settings: Partial<AsanaMcpSettings> | null): AsanaMcpSettings {
  return {
    clientId: typeof settings?.clientId === "string" ? settings.clientId : "",
    clientSecret:
      typeof settings?.clientSecret === "string" && settings.clientSecret.length > 0
        ? settings.clientSecret
        : null,
    accessToken:
      typeof settings?.accessToken === "string" && settings.accessToken.length > 0
        ? settings.accessToken
        : null,
    refreshToken:
      typeof settings?.refreshToken === "string" && settings.refreshToken.length > 0
        ? settings.refreshToken
        : null,
    accessTokenExpiresAt:
      typeof settings?.accessTokenExpiresAt === "string" ? settings.accessTokenExpiresAt : null,
    authorizedUserGid:
      typeof settings?.authorizedUserGid === "string" ? settings.authorizedUserGid : null,
    authorizedUserName:
      typeof settings?.authorizedUserName === "string" ? settings.authorizedUserName : null,
    authorizedUserEmail:
      typeof settings?.authorizedUserEmail === "string" ? settings.authorizedUserEmail : null,
    mcpServerUrl:
      typeof settings?.mcpServerUrl === "string" && settings.mcpServerUrl.trim()
        ? settings.mcpServerUrl.trim()
        : asanaMcpDefaults.mcpServerUrl,
    resourceUrl:
      typeof settings?.resourceUrl === "string" && settings.resourceUrl.trim()
        ? settings.resourceUrl.trim()
        : asanaMcpDefaults.resourceUrl,
    authorizationUrl:
      typeof settings?.authorizationUrl === "string" && settings.authorizationUrl.trim()
        ? settings.authorizationUrl.trim()
        : asanaMcpDefaults.authorizationUrl,
    updatedAt: typeof settings?.updatedAt === "string" ? settings.updatedAt : null,
  };
}

export function getAsanaMcpSettingsUnsafe() {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(asanaMcpSetting) as { value: string } | undefined;

  if (!row) {
    return normalizeAsanaMcpSettings(null);
  }

  return normalizeAsanaMcpSettings(JSON.parse(row.value) as Partial<AsanaMcpSettings>);
}

export function saveAsanaOAuthTokens(input: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  user?: {
    gid?: string | number | null;
    id?: string | number | null;
    name?: string | null;
    email?: string | null;
  } | null;
}) {
  const existing = getAsanaMcpSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const expiresIn =
    typeof input.expiresIn === "number" && Number.isFinite(input.expiresIn) ? input.expiresIn : 3600;
  const settings: AsanaMcpSettings = {
    ...existing,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken || existing.refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    authorizedUserGid:
      input.user?.gid !== undefined && input.user?.gid !== null
        ? String(input.user.gid)
        : input.user?.id !== undefined && input.user?.id !== null
          ? String(input.user.id)
          : existing.authorizedUserGid,
    authorizedUserName: input.user?.name ?? existing.authorizedUserName,
    authorizedUserEmail: input.user?.email ?? existing.authorizedUserEmail,
    updatedAt,
  };

  db.prepare(
    `
      INSERT INTO agent_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
  ).run(asanaMcpSetting, JSON.stringify(settings), updatedAt);

  return settings;
}

function normalizeAsanaBoards(value: unknown): AsanaBoardScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const board = entry as {
        boardId?: unknown;
        boardName?: unknown;
        workspaceName?: unknown;
      };
      const boardId = typeof board.boardId === "string" ? board.boardId.trim() : "";

      if (!boardId) {
        return null;
      }

      return {
        boardId,
        boardName: typeof board.boardName === "string" && board.boardName.trim() ? board.boardName.trim() : null,
        workspaceName:
          typeof board.workspaceName === "string" && board.workspaceName.trim()
            ? board.workspaceName.trim()
            : null,
      };
    })
    .filter((entry): entry is AsanaBoardScope => entry !== null);
}

function parseAsanaBoardsJson(value: string) {
  try {
    return normalizeAsanaBoards(JSON.parse(value));
  } catch {
    return [];
  }
}

function toAsanaChannelScope(row: {
  id: number;
  platform: string;
  context_id: string;
  channel_id: string;
  channel_name: string | null;
  access_mode: string;
  boards_json: string;
  created_at: string;
  updated_at: string;
}): AsanaChannelScope {
  return {
    id: row.id,
    platform: row.platform === "slack" ? "slack" : "discord",
    contextId: row.context_id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    mode: row.access_mode === "specific" ? "specific" : "all",
    boards: parseAsanaBoardsJson(row.boards_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAsanaChannelScope(input: {
  platform: "discord" | "slack";
  contextId: string;
  channelId: string;
}) {
  const row = db
    .prepare(
      `
        SELECT id, platform, context_id, channel_id, channel_name, access_mode, boards_json, created_at, updated_at
        FROM asana_channel_scopes
        WHERE platform = ? AND context_id = ? AND channel_id = ?
      `,
    )
    .get(input.platform, input.contextId, input.channelId) as
    | Parameters<typeof toAsanaChannelScope>[0]
    | undefined;

  return row ? toAsanaChannelScope(row) : null;
}

export function createAsanaToolRun(input: CreateAsanaToolRunInput) {
  db.prepare(
    `
      INSERT INTO asana_tool_runs (
        platform,
        context_id,
        channel_id,
        author_id,
        author_mention,
        tool_name,
        board_id,
        task_gid,
        success,
        error,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.platform,
    input.contextId,
    input.channelId,
    input.authorId?.trim() || null,
    input.authorMention?.trim() || null,
    input.toolName,
    input.boardId?.trim() || null,
    input.taskGid?.trim() || null,
    input.success ? 1 : 0,
    input.error?.slice(0, 1000) || null,
    new Date().toISOString(),
  );
}

export function getGuildKnowledgeSources(guildId: string): GuildKnowledgeSource[] {
  const rows = db
    .prepare(
      `
        SELECT id, guild_id, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, markdown_signature, markdown_manifest
        FROM guild_knowledge_sources
        WHERE guild_id = ? AND platform = ? AND clone_path != ''
        ORDER BY created_at DESC
      `,
    )
    .all(guildId, "github") as Array<{
    id: number;
    guild_id: string;
    repo_full_name: string;
    repo_ssh_url: string;
    repo_html_url: string;
    clone_path: string;
    vector_collection: string | null;
    indexed_at: string | null;
    indexed_markdown_files: number;
    indexed_chunks: number;
    markdown_signature: string | null;
    markdown_manifest: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    repoFullName: row.repo_full_name,
    repoSshUrl: row.repo_ssh_url,
    repoHtmlUrl: row.repo_html_url,
    clonePath: row.clone_path,
    vectorCollection: row.vector_collection,
    indexedAt: row.indexed_at,
    indexedMarkdownFiles: row.indexed_markdown_files,
    indexedChunks: row.indexed_chunks,
    markdownSignature: row.markdown_signature,
    markdownManifest: row.markdown_manifest,
  }));
}

export function getAllGithubKnowledgeSources(): GuildKnowledgeSource[] {
  const rows = db
    .prepare(
      `
        SELECT id, guild_id, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, markdown_signature, markdown_manifest
        FROM guild_knowledge_sources
        WHERE platform = ?
        ORDER BY guild_id, created_at DESC
      `,
    )
    .all("github") as Array<{
    id: number;
    guild_id: string;
    repo_full_name: string;
    repo_ssh_url: string;
    repo_html_url: string;
    clone_path: string;
    vector_collection: string | null;
    indexed_at: string | null;
    indexed_markdown_files: number;
    indexed_chunks: number;
    markdown_signature: string | null;
    markdown_manifest: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    repoFullName: row.repo_full_name,
    repoSshUrl: row.repo_ssh_url,
    repoHtmlUrl: row.repo_html_url,
    clonePath: row.clone_path,
    vectorCollection: row.vector_collection,
    indexedAt: row.indexed_at,
    indexedMarkdownFiles: row.indexed_markdown_files,
    indexedChunks: row.indexed_chunks,
    markdownSignature: row.markdown_signature,
    markdownManifest: row.markdown_manifest,
  }));
}

export function updateGuildKnowledgeClonePath(input: {
  guildId: string;
  sourceId: number;
  clonePath: string;
}) {
  db.prepare(
    `
      UPDATE guild_knowledge_sources
      SET clone_path = ?
      WHERE guild_id = ? AND id = ?
    `,
  ).run(input.clonePath, input.guildId, input.sourceId);
}

export function updateGuildKnowledgeIndexMetadata(input: {
  guildId: string;
  sourceId: number;
  vectorCollection: string;
  indexedMarkdownFiles: number;
  indexedChunks: number;
  markdownSignature: string;
  markdownManifest: string;
  indexedAt?: string;
}) {
  db.prepare(
    `
      UPDATE guild_knowledge_sources
      SET
        vector_collection = ?,
        indexed_at = ?,
        indexed_markdown_files = ?,
        indexed_chunks = ?,
        markdown_signature = ?,
        markdown_manifest = ?
      WHERE guild_id = ? AND id = ?
    `,
  ).run(
    input.vectorCollection,
    input.indexedAt ?? new Date().toISOString(),
    input.indexedMarkdownFiles,
    input.indexedChunks,
    input.markdownSignature,
    input.markdownManifest,
    input.guildId,
    input.sourceId,
  );
}

export function updateGuildKnowledgeMarkdownSnapshot(input: {
  guildId: string;
  sourceId: number;
  markdownSignature: string;
  markdownManifest: string;
  clonePath?: string;
}) {
  db.prepare(
    `
      UPDATE guild_knowledge_sources
      SET
        clone_path = COALESCE(?, clone_path),
        markdown_signature = ?,
        markdown_manifest = ?
      WHERE guild_id = ? AND id = ?
    `,
  ).run(
    input.clonePath ?? null,
    input.markdownSignature,
    input.markdownManifest,
    input.guildId,
    input.sourceId,
  );
}

export function getGithubSshKeyMetadata() {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get("github_ssh_key") as { value: string } | undefined;

  if (!row) {
    return null;
  }

  return JSON.parse(row.value) as GithubSshKeyMetadata;
}

function toDiscordChannelMessage(row: {
  guild_id: string;
  channel_id: string;
  message_id: string;
  role: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_mention: string;
  content: string;
  sent_at: string;
  created_at: string;
}): DiscordChannelMessage {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    role: row.role === "assistant" ? "assistant" : "user",
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    authorMention: row.author_mention,
    content: row.content,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export function saveDiscordChannelMessage(input: {
  guildId: string;
  channelId: string;
  messageId: string;
  role: DiscordChannelMessageRole;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorMention: string;
  content: string;
  sentAt: string;
}) {
  db.prepare(
    `
      INSERT OR IGNORE INTO discord_channel_messages (
        guild_id,
        channel_id,
        message_id,
        role,
        author_id,
        author_username,
        author_display_name,
        author_mention,
        content,
        sent_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.guildId,
    input.channelId,
    input.messageId,
    input.role,
    input.authorId,
    input.authorUsername,
    input.authorDisplayName,
    input.authorMention,
    input.content,
    input.sentAt,
    new Date().toISOString(),
  );
}

function toSlackChannelMessage(row: {
  workspace_id: string;
  channel_id: string;
  message_id: string;
  role: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_mention: string;
  content: string;
  sent_at: string;
  created_at: string;
}): SlackChannelMessage {
  return {
    workspaceId: row.workspace_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    role: row.role === "assistant" ? "assistant" : "user",
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    authorMention: row.author_mention,
    content: row.content,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export function saveSlackChannelMessage(input: {
  workspaceId: string;
  channelId: string;
  messageId: string;
  role: SlackChannelMessageRole;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorMention: string;
  content: string;
  sentAt: string;
}) {
  return db.prepare(
    `
      INSERT OR IGNORE INTO slack_channel_messages (
        workspace_id,
        channel_id,
        message_id,
        role,
        author_id,
        author_username,
        author_display_name,
        author_mention,
        content,
        sent_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.workspaceId,
    input.channelId,
    input.messageId,
    input.role,
    input.authorId,
    input.authorUsername,
    input.authorDisplayName,
    input.authorMention,
    input.content,
    input.sentAt,
    new Date().toISOString(),
  );
}

export function getDiscordChannelHistory(input: {
  guildId: string;
  channelId: string;
  limit: number;
}) {
  const rows = db
    .prepare(
      `
        SELECT
          guild_id,
          channel_id,
          message_id,
          role,
          author_id,
          author_username,
          author_display_name,
          author_mention,
          content,
          sent_at,
          created_at
        FROM discord_channel_messages
        WHERE guild_id = ? AND channel_id = ?
        ORDER BY sent_at DESC, id DESC
        LIMIT ?
      `,
    )
    .all(input.guildId, input.channelId, input.limit) as Parameters<
    typeof toDiscordChannelMessage
  >[0][];

  return rows.map(toDiscordChannelMessage).reverse();
}

export function getSlackChannelHistory(input: {
  workspaceId: string;
  channelId: string;
  limit: number;
}) {
  const rows = db
    .prepare(
      `
        SELECT
          workspace_id,
          channel_id,
          message_id,
          role,
          author_id,
          author_username,
          author_display_name,
          author_mention,
          content,
          sent_at,
          created_at
        FROM slack_channel_messages
        WHERE workspace_id = ? AND channel_id = ?
        ORDER BY sent_at DESC, id DESC
        LIMIT ?
      `,
    )
    .all(input.workspaceId, input.channelId, input.limit) as Parameters<
    typeof toSlackChannelMessage
  >[0][];

  return rows.map(toSlackChannelMessage).reverse();
}

export function createReminder(input: {
  platform: string;
  guildId?: string;
  channelId?: string;
  authorId?: string;
  authorMention?: string;
  title: string;
  message?: string;
  remindAt: string;
}) {
  const now = new Date().toISOString();
  const title = input.title.trim();

  if (!title) {
    throw new Error("title is required.");
  }

  const result = db
    .prepare(
      `
        INSERT INTO reminders (
          platform,
          guild_id,
          channel_id,
          author_id,
          author_mention,
          title,
          message,
          remind_at,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.platform,
      input.guildId ?? null,
      input.channelId ?? null,
      input.authorId ?? null,
      input.authorMention ?? null,
      title,
      input.message?.trim() || null,
      input.remindAt,
      "pending",
      now,
      now,
    ) as { lastInsertRowid: number | bigint };

  return getReminder(Number(result.lastInsertRowid));
}

export function getReminder(id: number) {
  const row = db
    .prepare(
      `
        SELECT id, platform, guild_id, channel_id, author_id, author_mention, title, message, remind_at, status, created_at, updated_at, sent_at
        FROM reminders
        WHERE id = ?
      `,
    )
    .get(id) as ReminderRow | undefined;

  return row ? toReminder(row) : null;
}

export function updateReminder(input: {
  id: number;
  title?: string;
  message?: string;
  remindAt?: string;
  status?: ReminderStatus;
}) {
  const existing = getReminder(input.id);

  if (!existing) {
    throw new Error(`Reminder ${input.id} not found.`);
  }

  const next = {
    title: input.title?.trim() || existing.title,
    message: input.message !== undefined ? input.message.trim() || null : existing.message,
    remindAt: input.remindAt ?? existing.remindAt,
    status: input.status ?? existing.status,
  };

  db.prepare(
    `
      UPDATE reminders
      SET title = ?, message = ?, remind_at = ?, status = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(next.title, next.message, next.remindAt, next.status, new Date().toISOString(), input.id);

  return getReminder(input.id);
}

export function cancelReminder(id: number) {
  return updateReminder({ id, status: "cancelled" });
}

function claimDueReminders(platform: string, nowIso: string) {
  const claim = db.transaction(() => {
    const now = new Date().toISOString();
    const rows = db
      .prepare(
        `
        SELECT id, platform, guild_id, channel_id, author_id, author_mention, title, message, remind_at, status, created_at, updated_at, sent_at
        FROM reminders
        WHERE platform = ? AND status = ? AND remind_at <= ?
        ORDER BY remind_at ASC, id ASC
      `,
      )
      .all(platform, "pending", nowIso) as ReminderRow[];
    const claimed: Reminder[] = [];
    const update = db.prepare(
      `
        UPDATE reminders
        SET status = ?, updated_at = ?
        WHERE id = ? AND status = ?
      `,
    );

    for (const row of rows) {
      const result = update.run("sending", now, row.id, "pending");

      if (result.changes === 1) {
        claimed.push(toReminder({ ...row, status: "sending", updated_at: now }));
      }
    }

    return claimed;
  });

  return claim();
}

export function claimDueDiscordReminders(nowIso: string) {
  return claimDueReminders("discord", nowIso);
}

export function claimDueSlackReminders(nowIso: string) {
  return claimDueReminders("slack", nowIso);
}

export function markReminderSent(id: number) {
  const now = new Date().toISOString();

  db.prepare(
    `
      UPDATE reminders
      SET status = ?, sent_at = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `,
  ).run("sent", now, now, id, "sending");

  return getReminder(id);
}

export function releaseReminderClaim(id: number) {
  const now = new Date().toISOString();

  db.prepare(
    `
      UPDATE reminders
      SET status = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `,
  ).run("pending", now, id, "sending");

  return getReminder(id);
}
