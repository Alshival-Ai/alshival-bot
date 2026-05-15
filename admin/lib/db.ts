import Database from "better-sqlite3";
import path from "node:path";

type DiscordRow = {
  bot_token: string | null;
  enabled: 0 | 1;
  desired_running: 0 | 1;
  updated_at: string | null;
};

type SaveDiscordSettingsInput = {
  token: string;
  enabled: boolean;
};

export type GithubSshKeyMetadata = {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  fingerprint: string;
  updatedAt: string;
};

export type GithubAccessSettings = {
  oauthClientId: string;
  personalAccessToken: string | null;
  updatedAt: string | null;
};

export type SafeGithubAccessSettings = {
  oauthClientId: string;
  hasPersonalAccessToken: boolean;
  personalAccessTokenLast4: string | null;
  updatedAt: string | null;
};

export type LanguageModelProvider = "openai" | "anthropic";

export type LanguageModelSettings = {
  provider: LanguageModelProvider;
  openAiApiKey: string | null;
  anthropicApiKey: string | null;
  updatedAt: string | null;
};

export type SafeLanguageModelSettings = {
  provider: LanguageModelProvider;
  hasOpenAiApiKey: boolean;
  openAiApiKeyLast4: string | null;
  hasAnthropicApiKey: boolean;
  anthropicApiKeyLast4: string | null;
  updatedAt: string | null;
};

export type AgentConfig = {
  provider: LanguageModelProvider;
  model: string;
  instructions: string;
  updatedAt: string | null;
};

export type GuildAgentConfig = AgentConfig & {
  inheritsDefault: boolean;
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

export type SafeMcpToolSettings = {
  gifSearch: {
    enabled: boolean;
    hasTenorApiKey: boolean;
    tenorApiKeyLast4: string | null;
    queryPrefix: string;
    defaultLimit: number;
    updatedAt: string | null;
  };
};

const dbPath = process.env.BOT_DB_PATH ?? path.join(process.cwd(), "bot.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS platform_settings (
    platform TEXT PRIMARY KEY,
    bot_token TEXT,
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
  CREATE INDEX IF NOT EXISTS idx_discord_channel_messages_channel_sent
  ON discord_channel_messages (guild_id, channel_id, sent_at, id)
`);

const columns = db.prepare("PRAGMA table_info(platform_settings)").all() as Array<{ name: string }>;
if (!columns.some((column) => column.name === "desired_running")) {
  db.exec("ALTER TABLE platform_settings ADD COLUMN desired_running INTEGER NOT NULL DEFAULT 0");
}

function toDiscordSettings(row: DiscordRow | undefined) {
  const token = row?.bot_token ?? "";

  return {
    enabled: Boolean(row?.enabled),
    desiredRunning: Boolean(row?.desired_running),
    hasToken: token.length > 0,
    tokenLast4: token.length > 0 ? token.slice(-4) : null,
    updatedAt: row?.updated_at ?? null,
  };
}

export function getDiscordSettings() {
  const row = db
    .prepare(
      "SELECT bot_token, enabled, desired_running, updated_at FROM platform_settings WHERE platform = ?",
    )
    .get("discord") as DiscordRow | undefined;

  return toDiscordSettings(row);
}

export function saveDiscordSettings({ token, enabled }: SaveDiscordSettingsInput) {
  const existing = db
    .prepare(
      "SELECT bot_token, enabled, desired_running, updated_at FROM platform_settings WHERE platform = ?",
    )
    .get("discord") as DiscordRow | undefined;
  const tokenToSave = token.length > 0 ? token : existing?.bot_token ?? null;

  db.prepare(
    `
      INSERT INTO platform_settings (platform, bot_token, enabled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        bot_token = excluded.bot_token,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `,
  ).run("discord", tokenToSave, enabled ? 1 : 0, new Date().toISOString());

  return getDiscordSettings();
}

const githubSshKeySetting = "github_ssh_key";

export function getGithubSshKeyMetadata() {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(githubSshKeySetting) as { value: string } | undefined;

  if (!row) {
    return null;
  }

  return JSON.parse(row.value) as GithubSshKeyMetadata;
}

export function saveGithubSshKeyMetadata(metadata: GithubSshKeyMetadata) {
  db.prepare(
    `
      INSERT INTO agent_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
  ).run(githubSshKeySetting, JSON.stringify(metadata), metadata.updatedAt);

  return metadata;
}

export function deleteGithubSshKeyMetadata() {
  db.prepare("DELETE FROM agent_settings WHERE key = ?").run(githubSshKeySetting);
}

const githubAccessSetting = "github_access";

function toSafeGithubAccessSettings(settings: GithubAccessSettings | null): SafeGithubAccessSettings {
  const token = settings?.personalAccessToken ?? "";

  return {
    oauthClientId: settings?.oauthClientId ?? "",
    hasPersonalAccessToken: token.length > 0,
    personalAccessTokenLast4: token.length > 0 ? token.slice(-4) : null,
    updatedAt: settings?.updatedAt ?? null,
  };
}

function getGithubAccessSettingsUnsafe() {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(githubAccessSetting) as { value: string } | undefined;

  if (!row) {
    return null;
  }

  return JSON.parse(row.value) as GithubAccessSettings;
}

export function getGithubAccessToken() {
  return getGithubAccessSettingsUnsafe()?.personalAccessToken ?? null;
}

export function getGithubAccessSettings() {
  return toSafeGithubAccessSettings(getGithubAccessSettingsUnsafe());
}

export function saveGithubAccessSettings(input: {
  oauthClientId: string;
  personalAccessToken: string;
}) {
  const existing = getGithubAccessSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const settings: GithubAccessSettings = {
    oauthClientId: input.oauthClientId.trim(),
    personalAccessToken:
      input.personalAccessToken.trim().length > 0
        ? input.personalAccessToken.trim()
        : existing?.personalAccessToken ?? null,
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
  ).run(githubAccessSetting, JSON.stringify(settings), updatedAt);

  return toSafeGithubAccessSettings(settings);
}

export function deleteGithubAccessSettings() {
  db.prepare("DELETE FROM agent_settings WHERE key = ?").run(githubAccessSetting);
  return getGithubAccessSettings();
}

const languageModelSetting = "language_models";

function isLanguageModelProvider(value: unknown): value is LanguageModelProvider {
  return value === "openai" || value === "anthropic";
}

function toSafeLanguageModelSettings(
  settings: LanguageModelSettings | null,
): SafeLanguageModelSettings {
  const openAiApiKey = settings?.openAiApiKey ?? "";
  const anthropicApiKey = settings?.anthropicApiKey ?? "";

  return {
    provider: settings?.provider ?? "openai",
    hasOpenAiApiKey: openAiApiKey.length > 0,
    openAiApiKeyLast4: openAiApiKey.length > 0 ? openAiApiKey.slice(-4) : null,
    hasAnthropicApiKey: anthropicApiKey.length > 0,
    anthropicApiKeyLast4: anthropicApiKey.length > 0 ? anthropicApiKey.slice(-4) : null,
    updatedAt: settings?.updatedAt ?? null,
  };
}

function getLanguageModelSettingsUnsafe() {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(languageModelSetting) as { value: string } | undefined;

  if (!row) {
    return null;
  }

  const parsed = JSON.parse(row.value) as Partial<LanguageModelSettings>;

  return {
    provider: isLanguageModelProvider(parsed.provider) ? parsed.provider : "openai",
    openAiApiKey: parsed.openAiApiKey ?? null,
    anthropicApiKey: parsed.anthropicApiKey ?? null,
    updatedAt: parsed.updatedAt ?? null,
  } satisfies LanguageModelSettings;
}

export function getLanguageModelSettings() {
  return toSafeLanguageModelSettings(getLanguageModelSettingsUnsafe());
}

export function getLanguageModelApiKey(provider: LanguageModelProvider) {
  const settings = getLanguageModelSettingsUnsafe();
  return provider === "openai" ? settings?.openAiApiKey ?? null : settings?.anthropicApiKey ?? null;
}

export function saveLanguageModelSettings(input: {
  provider: string;
  openAiApiKey: string;
  anthropicApiKey: string;
}) {
  const existing = getLanguageModelSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const settings: LanguageModelSettings = {
    provider: isLanguageModelProvider(input.provider) ? input.provider : existing?.provider ?? "openai",
    openAiApiKey:
      input.openAiApiKey.trim().length > 0
        ? input.openAiApiKey.trim()
        : existing?.openAiApiKey ?? null,
    anthropicApiKey:
      input.anthropicApiKey.trim().length > 0
        ? input.anthropicApiKey.trim()
        : existing?.anthropicApiKey ?? null,
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
  ).run(languageModelSetting, JSON.stringify(settings), updatedAt);

  return toSafeLanguageModelSettings(settings);
}

export function deleteLanguageModelSettings() {
  db.prepare("DELETE FROM agent_settings WHERE key = ?").run(languageModelSetting);
  return getLanguageModelSettings();
}

const agentConfigSetting = "agent_config";

export function getAgentConfig(): AgentConfig {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(agentConfigSetting) as { value: string } | undefined;

  if (!row) {
    return {
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

export function saveAgentConfig(input: {
  provider: string;
  model: string;
  instructions: string;
}) {
  const existing = getAgentConfig();
  const updatedAt = new Date().toISOString();
  const settings: AgentConfig = {
    provider: isLanguageModelProvider(input.provider) ? input.provider : existing.provider,
    model: input.model.trim() || existing.model,
    instructions: input.instructions.trim() || existing.instructions,
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
  ).run(agentConfigSetting, JSON.stringify(settings), updatedAt);

  return settings;
}

function getGuildAgentConfigSetting(guildId: string) {
  return `discord_guild_agent_config:${guildId}`;
}

export function getGuildAgentConfig(guildId: string): GuildAgentConfig {
  const defaultConfig = getAgentConfig();
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(getGuildAgentConfigSetting(guildId)) as { value: string } | undefined;

  if (!row) {
    return {
      ...defaultConfig,
      inheritsDefault: true,
    };
  }

  const parsed = JSON.parse(row.value) as Partial<AgentConfig>;

  return {
    provider: isLanguageModelProvider(parsed.provider) ? parsed.provider : defaultConfig.provider,
    model:
      typeof parsed.model === "string" && parsed.model.trim()
        ? parsed.model.trim()
        : defaultConfig.model,
    instructions:
      typeof parsed.instructions === "string" && parsed.instructions.trim()
        ? parsed.instructions.trim()
        : defaultConfig.instructions,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    inheritsDefault: false,
  };
}

export function saveGuildAgentConfig(
  guildId: string,
  input: {
    provider: string;
    model: string;
    instructions: string;
  },
) {
  const defaultConfig = getAgentConfig();
  const updatedAt = new Date().toISOString();
  const settings: AgentConfig = {
    provider: isLanguageModelProvider(input.provider) ? input.provider : defaultConfig.provider,
    model: input.model.trim() || defaultConfig.model,
    instructions: input.instructions.trim() || defaultConfig.instructions,
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
  ).run(getGuildAgentConfigSetting(guildId), JSON.stringify(settings), updatedAt);

  return getGuildAgentConfig(guildId);
}

export function deleteGuildAgentConfig(guildId: string) {
  db.prepare("DELETE FROM agent_settings WHERE key = ?").run(getGuildAgentConfigSetting(guildId));
  return getGuildAgentConfig(guildId);
}

export function deleteDiscordGuildChatHistory(guildId: string) {
  const result = db
    .prepare("DELETE FROM discord_channel_messages WHERE guild_id = ?")
    .run(guildId) as { changes: number };

  return {
    deletedMessages: result.changes,
  };
}

const mcpToolsSetting = "mcp_tools";

function getMcpToolSettingsUnsafe(): McpToolSettings {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(mcpToolsSetting) as { value: string } | undefined;

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

function toSafeMcpToolSettings(settings: McpToolSettings): SafeMcpToolSettings {
  const tenorApiKey = settings.gifSearch.tenorApiKey ?? "";

  return {
    gifSearch: {
      enabled: settings.gifSearch.enabled,
      hasTenorApiKey: tenorApiKey.length > 0,
      tenorApiKeyLast4: tenorApiKey.length > 0 ? tenorApiKey.slice(-4) : null,
      queryPrefix: settings.gifSearch.queryPrefix,
      defaultLimit: settings.gifSearch.defaultLimit,
      updatedAt: settings.gifSearch.updatedAt,
    },
  };
}

export function getMcpToolSettings() {
  return toSafeMcpToolSettings(getMcpToolSettingsUnsafe());
}

export function saveMcpToolSettings(input: {
  gifSearch: {
    enabled: boolean;
    tenorApiKey: string;
    queryPrefix: string;
    defaultLimit: number;
  };
}) {
  const existing = getMcpToolSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const settings: McpToolSettings = {
    gifSearch: {
      enabled: input.gifSearch.enabled,
      tenorApiKey:
        input.gifSearch.tenorApiKey.trim().length > 0
          ? input.gifSearch.tenorApiKey.trim()
          : existing.gifSearch.tenorApiKey,
      queryPrefix: input.gifSearch.queryPrefix.trim(),
      defaultLimit: Math.max(1, Math.min(Math.trunc(input.gifSearch.defaultLimit || 8), 20)),
      updatedAt,
    },
  };

  db.prepare(
    `
      INSERT INTO agent_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
  ).run(mcpToolsSetting, JSON.stringify(settings), updatedAt);

  return toSafeMcpToolSettings(settings);
}

export function deleteMcpToolSettings() {
  db.prepare("DELETE FROM agent_settings WHERE key = ?").run(mcpToolsSetting);
  return getMcpToolSettings();
}

export type GuildKnowledgeSource = {
  id: number;
  platform: "github";
  repoFullName: string;
  repoSshUrl: string;
  repoHtmlUrl: string;
  clonePath: string;
  vectorCollection: string | null;
  indexedAt: string | null;
  indexedMarkdownFiles: number;
  indexedChunks: number;
  private: boolean;
  createdAt: string;
};

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

function toGuildKnowledgeSource(row: {
  id: number;
  platform: string;
  repo_full_name: string;
  repo_ssh_url: string;
  repo_html_url: string;
  clone_path: string;
  vector_collection: string | null;
  indexed_at: string | null;
  indexed_markdown_files: number;
  indexed_chunks: number;
  private: 0 | 1;
  created_at: string;
}): GuildKnowledgeSource {
  return {
    id: row.id,
    platform: "github",
    repoFullName: row.repo_full_name,
    repoSshUrl: row.repo_ssh_url,
    repoHtmlUrl: row.repo_html_url,
    clonePath: row.clone_path,
    vectorCollection: row.vector_collection,
    indexedAt: row.indexed_at,
    indexedMarkdownFiles: row.indexed_markdown_files,
    indexedChunks: row.indexed_chunks,
    private: Boolean(row.private),
    createdAt: row.created_at,
  };
}

export function getGuildKnowledgeSources(guildId: string) {
  const rows = db
    .prepare(
      `
        SELECT id, platform, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, private, created_at
        FROM guild_knowledge_sources
        WHERE guild_id = ?
        ORDER BY created_at DESC
      `,
    )
    .all(guildId) as Parameters<typeof toGuildKnowledgeSource>[0][];

  return rows.map(toGuildKnowledgeSource);
}

export function addGuildKnowledgeSource(input: {
  guildId: string;
    repoFullName: string;
    repoSshUrl: string;
    repoHtmlUrl: string;
    clonePath: string;
    private: boolean;
}) {
  const createdAt = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO guild_knowledge_sources (
        platform,
        guild_id,
        repo_full_name,
        repo_ssh_url,
        repo_html_url,
        clone_path,
        private,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, platform, repo_full_name) DO UPDATE SET
        repo_ssh_url = excluded.repo_ssh_url,
        repo_html_url = excluded.repo_html_url,
        clone_path = excluded.clone_path,
        private = excluded.private
    `,
  ).run(
    "github",
    input.guildId,
    input.repoFullName,
    input.repoSshUrl,
    input.repoHtmlUrl,
    input.clonePath,
    input.private ? 1 : 0,
    createdAt,
  );

  return getGuildKnowledgeSources(input.guildId);
}

export function getGuildKnowledgeSource(guildId: string, sourceId: number) {
  const row = db
    .prepare(
      `
        SELECT id, platform, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, private, created_at
        FROM guild_knowledge_sources
        WHERE guild_id = ? AND id = ?
      `,
    )
    .get(guildId, sourceId) as Parameters<typeof toGuildKnowledgeSource>[0] | undefined;

  return row ? toGuildKnowledgeSource(row) : null;
}

export function getGuildKnowledgeSourceByRepo(guildId: string, repoFullName: string) {
  const row = db
    .prepare(
      `
        SELECT id, platform, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, private, created_at
        FROM guild_knowledge_sources
        WHERE guild_id = ? AND platform = ? AND repo_full_name = ?
      `,
    )
    .get(guildId, "github", repoFullName) as Parameters<typeof toGuildKnowledgeSource>[0] | undefined;

  return row ? toGuildKnowledgeSource(row) : null;
}

export function updateGuildKnowledgeIndexMetadata(input: {
  guildId: string;
  sourceId: number;
  vectorCollection: string;
  indexedMarkdownFiles: number;
  indexedChunks: number;
}) {
  db.prepare(
    `
      UPDATE guild_knowledge_sources
      SET
        vector_collection = ?,
        indexed_at = ?,
        indexed_markdown_files = ?,
        indexed_chunks = ?
      WHERE guild_id = ? AND id = ?
    `,
  ).run(
    input.vectorCollection,
    new Date().toISOString(),
    input.indexedMarkdownFiles,
    input.indexedChunks,
    input.guildId,
    input.sourceId,
  );

  return getGuildKnowledgeSource(input.guildId, input.sourceId);
}

export function deleteGuildKnowledgeSource(guildId: string, sourceId: number) {
  db.prepare("DELETE FROM guild_knowledge_sources WHERE guild_id = ? AND id = ?").run(
    guildId,
    sourceId,
  );

  return getGuildKnowledgeSources(guildId);
}
