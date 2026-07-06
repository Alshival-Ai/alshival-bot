import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

type DiscordRow = {
  bot_token: string | null;
  app_token: string | null;
  enabled: 0 | 1;
  desired_running: 0 | 1;
  updated_at: string | null;
};

type SaveDiscordSettingsInput = {
  token: string;
  enabled: boolean;
};

type SaveSlackSettingsInput = {
  botToken: string;
  appToken: string;
  enabled: boolean;
};

type SlackWorkspaceSettingsRow = {
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

export type SafeSlackWorkspaceSettings = {
  workspaceId: string;
  workspaceName: string | null;
  workspaceDomain: string | null;
  enabled: boolean;
  desiredRunning: boolean;
  hasBotToken: boolean;
  botTokenLast4: string | null;
  hasAppToken: boolean;
  appTokenLast4: string | null;
  botUserId: string | null;
  botName: string | null;
  createdAt: string;
  updatedAt: string;
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
  tokens?: GithubAccessTokenSettings[];
  updatedAt: string | null;
};

export type GithubAccessTokenSettings = {
  id: string;
  org: string;
  personalAccessToken: string;
  updatedAt: string;
};

export type SafeGithubAccessSettings = {
  oauthClientId: string;
  hasPersonalAccessToken: boolean;
  personalAccessTokenLast4: string | null;
  tokens: SafeGithubAccessTokenSettings[];
  updatedAt: string | null;
};

export type SafeGithubAccessTokenSettings = {
  id: string;
  org: string;
  hasPersonalAccessToken: boolean;
  personalAccessTokenLast4: string | null;
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

export type SafeAsanaMcpSettings = {
  clientId: string;
  hasClientSecret: boolean;
  clientSecretLast4: string | null;
  connected: boolean;
  authorizedUserGid: string | null;
  authorizedUserName: string | null;
  authorizedUserEmail: string | null;
  accessTokenExpiresAt: string | null;
  mcpServerUrl: string;
  resourceUrl: string;
  authorizationUrl: string;
  updatedAt: string | null;
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
    klipyApiKey: string | null;
    queryPrefix: string;
    defaultLimit: number;
    updatedAt: string | null;
  };
};

export type SafeMcpToolSettings = {
  gifSearch: {
    enabled: boolean;
    hasKlipyApiKey: boolean;
    klipyApiKeyLast4: string | null;
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
  CREATE INDEX IF NOT EXISTS idx_discord_channel_messages_channel_sent
  ON discord_channel_messages (guild_id, channel_id, sent_at, id)
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
  CREATE INDEX IF NOT EXISTS idx_slack_channel_messages_channel_sent
  ON slack_channel_messages (workspace_id, channel_id, sent_at, id)
`);

const columns = db.prepare("PRAGMA table_info(platform_settings)").all() as Array<{ name: string }>;
if (!columns.some((column) => column.name === "desired_running")) {
  db.exec("ALTER TABLE platform_settings ADD COLUMN desired_running INTEGER NOT NULL DEFAULT 0");
}
if (!columns.some((column) => column.name === "app_token")) {
  db.exec("ALTER TABLE platform_settings ADD COLUMN app_token TEXT");
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
      "SELECT bot_token, app_token, enabled, desired_running, updated_at FROM platform_settings WHERE platform = ?",
    )
    .get("discord") as DiscordRow | undefined;

  return toDiscordSettings(row);
}

export function saveDiscordSettings({ token, enabled }: SaveDiscordSettingsInput) {
  const existing = db
    .prepare(
      "SELECT bot_token, app_token, enabled, desired_running, updated_at FROM platform_settings WHERE platform = ?",
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

function toSlackSettings(row: DiscordRow | undefined) {
  const botToken = row?.bot_token ?? "";
  const appToken = row?.app_token ?? "";

  return {
    enabled: Boolean(row?.enabled),
    desiredRunning: Boolean(row?.desired_running),
    hasBotToken: botToken.length > 0,
    botTokenLast4: botToken.length > 0 ? botToken.slice(-4) : null,
    hasAppToken: appToken.length > 0,
    appTokenLast4: appToken.length > 0 ? appToken.slice(-4) : null,
    updatedAt: row?.updated_at ?? null,
  };
}

export function getSlackSettings() {
  const row = db
    .prepare(
      "SELECT bot_token, app_token, enabled, desired_running, updated_at FROM platform_settings WHERE platform = ?",
    )
    .get("slack") as DiscordRow | undefined;

  return toSlackSettings(row);
}

export function saveSlackSettings({ botToken, appToken, enabled }: SaveSlackSettingsInput) {
  const existing = db
    .prepare(
      "SELECT bot_token, app_token, enabled, desired_running, updated_at FROM platform_settings WHERE platform = ?",
    )
    .get("slack") as DiscordRow | undefined;
  const botTokenToSave = botToken.length > 0 ? botToken : existing?.bot_token ?? null;
  const appTokenToSave = appToken.length > 0 ? appToken : existing?.app_token ?? null;

  db.prepare(
    `
      INSERT INTO platform_settings (platform, bot_token, app_token, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        bot_token = excluded.bot_token,
        app_token = excluded.app_token,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `,
  ).run("slack", botTokenToSave, appTokenToSave, enabled ? 1 : 0, new Date().toISOString());

  return getSlackSettings();
}

function toSafeSlackWorkspaceSettings(row: SlackWorkspaceSettingsRow): SafeSlackWorkspaceSettings {
  const botToken = row.bot_token ?? "";
  const appToken = row.app_token ?? "";

  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceDomain: row.workspace_domain,
    enabled: Boolean(row.enabled),
    desiredRunning: Boolean(row.desired_running),
    hasBotToken: botToken.length > 0,
    botTokenLast4: botToken.length > 0 ? botToken.slice(-4) : null,
    hasAppToken: appToken.length > 0,
    appTokenLast4: appToken.length > 0 ? appToken.slice(-4) : null,
    botUserId: row.bot_user_id,
    botName: row.bot_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSlackWorkspaceSettings() {
  const rows = db
    .prepare(
      `
        SELECT workspace_id, workspace_name, workspace_domain, bot_token, app_token, enabled, desired_running, bot_user_id, bot_name, created_at, updated_at
        FROM slack_workspace_settings
        ORDER BY workspace_name COLLATE NOCASE, workspace_id
      `,
    )
    .all() as SlackWorkspaceSettingsRow[];

  return rows.map(toSafeSlackWorkspaceSettings);
}

export function getSlackWorkspaceSettingUnsafe(workspaceId: string) {
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

export function saveSlackWorkspaceSettings(input: {
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
  const existing = getSlackWorkspaceSettingUnsafe(input.workspaceId);
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

  const row = getSlackWorkspaceSettingUnsafe(input.workspaceId);

  if (!row) {
    throw new Error("Could not save Slack workspace settings.");
  }

  return toSafeSlackWorkspaceSettings(row);
}

export function deleteSlackWorkspaceSettings(workspaceId: string) {
  db.prepare("DELETE FROM slack_workspace_settings WHERE workspace_id = ?").run(workspaceId);
  return getSlackWorkspaceSettings();
}

export function setSlackWorkspaceEnabled(workspaceId: string, enabled: boolean) {
  db.prepare(
    `
      UPDATE slack_workspace_settings
      SET enabled = ?, desired_running = CASE WHEN ? = 0 THEN 0 ELSE desired_running END, updated_at = ?
      WHERE workspace_id = ?
    `,
  ).run(enabled ? 1 : 0, enabled ? 1 : 0, new Date().toISOString(), workspaceId);

  const row = getSlackWorkspaceSettingUnsafe(workspaceId);

  if (!row) {
    throw new Error("Slack workspace is not configured.");
  }

  return toSafeSlackWorkspaceSettings(row);
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
    tokens: getGithubAccessTokensFromSettings(settings).map((entry) => ({
      id: entry.id,
      org: entry.org,
      hasPersonalAccessToken: entry.personalAccessToken.length > 0,
      personalAccessTokenLast4: entry.personalAccessToken.length > 0 ? entry.personalAccessToken.slice(-4) : null,
      updatedAt: entry.updatedAt,
    })),
    updatedAt: settings?.updatedAt ?? null,
  };
}

function getGithubAccessTokensFromSettings(settings: GithubAccessSettings | null): GithubAccessTokenSettings[] {
  if (!settings) {
    return [];
  }

  if (Array.isArray(settings.tokens)) {
    return settings.tokens
      .filter(
        (entry) =>
          typeof entry.id === "string" &&
          typeof entry.org === "string" &&
          typeof entry.personalAccessToken === "string" &&
          entry.personalAccessToken.length > 0,
      )
      .map((entry) => ({
        id: entry.id,
        org: entry.org.trim() || "default",
        personalAccessToken: entry.personalAccessToken,
        updatedAt: entry.updatedAt || settings.updatedAt || new Date().toISOString(),
      }));
  }

  if (settings.personalAccessToken) {
    return [
      {
        id: "default",
        org: "default",
        personalAccessToken: settings.personalAccessToken,
        updatedAt: settings.updatedAt ?? new Date().toISOString(),
      },
    ];
  }

  return [];
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

export function getGithubAccessTokens() {
  return getGithubAccessTokensFromSettings(getGithubAccessSettingsUnsafe());
}

export function getGithubAccessSettings() {
  return toSafeGithubAccessSettings(getGithubAccessSettingsUnsafe());
}

export function saveGithubAccessSettings(input: {
  oauthClientId: string;
  personalAccessToken: string;
  org?: string;
}) {
  const existing = getGithubAccessSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const org = input.org?.trim() || "default";
  const existingTokens = getGithubAccessTokensFromSettings(existing);
  const token = input.personalAccessToken.trim();
  const nextTokens =
    token.length > 0
      ? [
          ...existingTokens.filter((entry) => entry.org.toLowerCase() !== org.toLowerCase()),
          {
            id: crypto.randomUUID(),
            org,
            personalAccessToken: token,
            updatedAt,
          },
        ].sort((left, right) => left.org.localeCompare(right.org))
      : existingTokens;
  const settings: GithubAccessSettings = {
    oauthClientId: input.oauthClientId.trim(),
    personalAccessToken: null,
    tokens: nextTokens,
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

export function deleteGithubAccessToken(tokenId: string) {
  const existing = getGithubAccessSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const settings: GithubAccessSettings = {
    oauthClientId: existing?.oauthClientId ?? "",
    personalAccessToken: null,
    tokens: getGithubAccessTokensFromSettings(existing).filter((entry) => entry.id !== tokenId),
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

const asanaMcpSetting = "asana_mcp_settings";
const asanaMcpDefaults = {
  mcpServerUrl: "https://mcp.asana.com/v2/mcp",
  resourceUrl: "https://mcp.asana.com/v2",
  authorizationUrl: "https://app.asana.com/-/oauth_authorize",
};

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

function toSafeAsanaMcpSettings(settings: AsanaMcpSettings): SafeAsanaMcpSettings {
  const clientSecret = settings.clientSecret ?? "";

  return {
    clientId: settings.clientId,
    hasClientSecret: clientSecret.length > 0,
    clientSecretLast4: clientSecret.length > 0 ? clientSecret.slice(-4) : null,
    connected: Boolean(settings.refreshToken || settings.accessToken),
    authorizedUserGid: settings.authorizedUserGid,
    authorizedUserName: settings.authorizedUserName,
    authorizedUserEmail: settings.authorizedUserEmail,
    accessTokenExpiresAt: settings.accessTokenExpiresAt,
    mcpServerUrl: settings.mcpServerUrl,
    resourceUrl: settings.resourceUrl,
    authorizationUrl: settings.authorizationUrl,
    updatedAt: settings.updatedAt,
  };
}

function getAsanaMcpSettingsUnsafe() {
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(asanaMcpSetting) as { value: string } | undefined;

  if (!row) {
    return normalizeAsanaMcpSettings(null);
  }

  return normalizeAsanaMcpSettings(JSON.parse(row.value) as Partial<AsanaMcpSettings>);
}

export function getAsanaMcpSettings() {
  return toSafeAsanaMcpSettings(getAsanaMcpSettingsUnsafe());
}

export function getAsanaMcpSettingsPrivate() {
  return getAsanaMcpSettingsUnsafe();
}

export function saveAsanaMcpSettings(input: {
  clientId: string;
  clientSecret: string;
}) {
  const existing = getAsanaMcpSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const settings: AsanaMcpSettings = {
    ...asanaMcpDefaults,
    ...existing,
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret.trim() || existing.clientSecret,
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

  return toSafeAsanaMcpSettings(settings);
}

export function deleteAsanaMcpSettings() {
  db.prepare("DELETE FROM agent_settings WHERE key = ?").run(asanaMcpSetting);
  return getAsanaMcpSettings();
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
  const expiresIn = typeof input.expiresIn === "number" && Number.isFinite(input.expiresIn)
    ? input.expiresIn
    : 3600;
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

export function getAsanaChannelScopes(input: {
  platform: "discord" | "slack";
  contextId: string;
}) {
  const rows = db
    .prepare(
      `
        SELECT id, platform, context_id, channel_id, channel_name, access_mode, boards_json, created_at, updated_at
        FROM asana_channel_scopes
        WHERE platform = ? AND context_id = ?
        ORDER BY updated_at DESC, channel_id
      `,
    )
    .all(input.platform, input.contextId) as Parameters<typeof toAsanaChannelScope>[0][];

  return rows.map(toAsanaChannelScope);
}

export function saveAsanaChannelScope(input: {
  platform: "discord" | "slack";
  contextId: string;
  channelId: string;
  channelName?: string | null;
  mode: AsanaChannelScopeMode;
  boards?: AsanaBoardScope[];
}) {
  const channelId = input.channelId.trim();
  const mode = input.mode === "specific" ? "specific" : "all";
  const boards = mode === "specific" ? normalizeAsanaBoards(input.boards ?? []) : [];

  if (!channelId) {
    throw new Error("channelId is required.");
  }

  if (mode === "specific" && boards.length === 0) {
    throw new Error("At least one Asana board is required for specific-board access.");
  }

  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO asana_channel_scopes (
        platform,
        context_id,
        channel_id,
        channel_name,
        access_mode,
        boards_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, context_id, channel_id) DO UPDATE SET
        channel_name = excluded.channel_name,
        access_mode = excluded.access_mode,
        boards_json = excluded.boards_json,
        updated_at = excluded.updated_at
    `,
  ).run(
    input.platform,
    input.contextId,
    channelId,
    input.channelName?.trim() || null,
    mode,
    JSON.stringify(boards),
    now,
    now,
  );

  return getAsanaChannelScopes({
    platform: input.platform,
    contextId: input.contextId,
  });
}

export function deleteAsanaChannelScope(input: {
  platform: "discord" | "slack";
  contextId: string;
  channelId: string;
}) {
  db.prepare(
    `
      DELETE FROM asana_channel_scopes
      WHERE platform = ? AND context_id = ? AND channel_id = ?
    `,
  ).run(input.platform, input.contextId, input.channelId);

  return getAsanaChannelScopes({
    platform: input.platform,
    contextId: input.contextId,
  });
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

function getWorkspaceAgentConfigSetting(workspaceId: string) {
  return `slack_workspace_agent_config:${workspaceId}`;
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

export function getWorkspaceAgentConfig(workspaceId: string): GuildAgentConfig {
  const defaultConfig = getAgentConfig();
  const row = db
    .prepare("SELECT value FROM agent_settings WHERE key = ?")
    .get(getWorkspaceAgentConfigSetting(workspaceId)) as { value: string } | undefined;

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

export function saveWorkspaceAgentConfig(
  workspaceId: string,
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
  ).run(getWorkspaceAgentConfigSetting(workspaceId), JSON.stringify(settings), updatedAt);

  return getWorkspaceAgentConfig(workspaceId);
}

export function deleteWorkspaceAgentConfig(workspaceId: string) {
  db.prepare("DELETE FROM agent_settings WHERE key = ?").run(
    getWorkspaceAgentConfigSetting(workspaceId),
  );
  return getWorkspaceAgentConfig(workspaceId);
}

export function deleteDiscordGuildChatHistory(guildId: string) {
  const result = db
    .prepare("DELETE FROM discord_channel_messages WHERE guild_id = ?")
    .run(guildId) as { changes: number };

  return {
    deletedMessages: result.changes,
  };
}

export function deleteSlackWorkspaceChatHistory(workspaceId: string) {
  const result = db
    .prepare("DELETE FROM slack_channel_messages WHERE workspace_id = ?")
    .run(workspaceId) as { changes: number };

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

function toSafeMcpToolSettings(settings: McpToolSettings): SafeMcpToolSettings {
  const klipyApiKey = settings.gifSearch.klipyApiKey ?? "";

  return {
    gifSearch: {
      enabled: settings.gifSearch.enabled,
      hasKlipyApiKey: klipyApiKey.length > 0,
      klipyApiKeyLast4: klipyApiKey.length > 0 ? klipyApiKey.slice(-4) : null,
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
    klipyApiKey: string;
    queryPrefix: string;
    defaultLimit: number;
  };
}) {
  const existing = getMcpToolSettingsUnsafe();
  const updatedAt = new Date().toISOString();
  const settings: McpToolSettings = {
    gifSearch: {
      enabled: input.gifSearch.enabled,
      klipyApiKey:
        input.gifSearch.klipyApiKey.trim().length > 0
          ? input.gifSearch.klipyApiKey.trim()
          : existing.gifSearch.klipyApiKey,
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
  markdownSignature: string | null;
  markdownManifest: string | null;
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
if (!guildKnowledgeColumns.some((column) => column.name === "markdown_signature")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN markdown_signature TEXT");
}
if (!guildKnowledgeColumns.some((column) => column.name === "markdown_manifest")) {
  db.exec("ALTER TABLE guild_knowledge_sources ADD COLUMN markdown_manifest TEXT");
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
  markdown_signature: string | null;
  markdown_manifest: string | null;
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
    markdownSignature: row.markdown_signature,
    markdownManifest: row.markdown_manifest,
    private: Boolean(row.private),
    createdAt: row.created_at,
  };
}

export function getGuildKnowledgeSources(guildId: string) {
  const rows = db
    .prepare(
      `
        SELECT id, platform, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, markdown_signature, markdown_manifest, private, created_at
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
        SELECT id, platform, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, markdown_signature, markdown_manifest, private, created_at
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
        SELECT id, platform, repo_full_name, repo_ssh_url, repo_html_url, clone_path, vector_collection, indexed_at, indexed_markdown_files, indexed_chunks, markdown_signature, markdown_manifest, private, created_at
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
  markdownSignature?: string;
  markdownManifest?: string;
}) {
  db.prepare(
    `
      UPDATE guild_knowledge_sources
      SET
        vector_collection = ?,
        indexed_at = ?,
        indexed_markdown_files = ?,
        indexed_chunks = ?,
        markdown_signature = COALESCE(?, markdown_signature),
        markdown_manifest = COALESCE(?, markdown_manifest)
      WHERE guild_id = ? AND id = ?
    `,
  ).run(
    input.vectorCollection,
    new Date().toISOString(),
    input.indexedMarkdownFiles,
    input.indexedChunks,
    input.markdownSignature ?? null,
    input.markdownManifest ?? null,
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
