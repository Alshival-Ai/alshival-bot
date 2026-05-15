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

export type McpToolSettings = {
  gifSearch: {
    enabled: boolean;
    tenorApiKey: string | null;
    queryPrefix: string;
    defaultLimit: number;
    updatedAt: string | null;
  };
};

export type GuildKnowledgeSource = {
  id: number;
  repoFullName: string;
  clonePath: string;
  indexedAt: string | null;
};

export type ReminderStatus = "pending" | "sent" | "cancelled";

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

function toReminder(row: {
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
}): Reminder {
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
      row.status === "sent" || row.status === "cancelled"
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
        tenorApiKey: null,
        queryPrefix: "",
        defaultLimit: 8,
        updatedAt: null,
      },
    };
  }

  const parsed = JSON.parse(row.value) as Partial<McpToolSettings>;
  const gifSearch = parsed.gifSearch ?? {
    enabled: false,
    tenorApiKey: null,
    queryPrefix: "",
    defaultLimit: 8,
    updatedAt: null,
  };

  return {
    gifSearch: {
      enabled: Boolean(gifSearch.enabled),
      tenorApiKey:
        typeof gifSearch.tenorApiKey === "string" && gifSearch.tenorApiKey.trim()
          ? gifSearch.tenorApiKey
          : null,
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

export function getGuildKnowledgeSources(guildId: string): GuildKnowledgeSource[] {
  const rows = db
    .prepare(
      `
        SELECT id, repo_full_name, clone_path, indexed_at
        FROM guild_knowledge_sources
        WHERE guild_id = ? AND platform = ? AND clone_path != ''
        ORDER BY created_at DESC
      `,
    )
    .all(guildId, "github") as Array<{
    id: number;
    repo_full_name: string;
    clone_path: string;
    indexed_at: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    repoFullName: row.repo_full_name,
    clonePath: row.clone_path,
    indexedAt: row.indexed_at,
  }));
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
  db.prepare(
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
    .get(id) as Parameters<typeof toReminder>[0] | undefined;

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

export function getDueDiscordReminders(nowIso: string) {
  const rows = db
    .prepare(
      `
        SELECT id, platform, guild_id, channel_id, author_id, author_mention, title, message, remind_at, status, created_at, updated_at, sent_at
        FROM reminders
        WHERE platform = ? AND status = ? AND remind_at <= ?
        ORDER BY remind_at ASC, id ASC
      `,
    )
    .all("discord", "pending", nowIso) as Parameters<typeof toReminder>[0][];

  return rows.map(toReminder);
}

export function getDueSlackReminders(nowIso: string) {
  const rows = db
    .prepare(
      `
        SELECT id, platform, guild_id, channel_id, author_id, author_mention, title, message, remind_at, status, created_at, updated_at, sent_at
        FROM reminders
        WHERE platform = ? AND status = ? AND remind_at <= ?
        ORDER BY remind_at ASC, id ASC
      `,
    )
    .all("slack", "pending", nowIso) as Parameters<typeof toReminder>[0][];

  return rows.map(toReminder);
}

export function markReminderSent(id: number) {
  const now = new Date().toISOString();

  db.prepare(
    `
      UPDATE reminders
      SET status = ?, sent_at = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run("sent", now, now, id);

  return getReminder(id);
}
