export type PlatformStatus = {
  platform: string;
  configured: boolean;
  enabled: boolean;
  desiredRunning: boolean;
  running: boolean;
  ready: boolean;
  displayName?: string;
  error?: string;
};

export type PlatformAdapter = {
  platform: string;
  status(): PlatformStatus;
  reconcile(): Promise<PlatformStatus>;
  start(): Promise<PlatformStatus>;
  stop(): Promise<PlatformStatus>;
};

export type DiscordGuildSummary = {
  id: string;
  name: string;
  memberCount: number | null;
  iconUrl: string | null;
  available: boolean;
  ownerId: string | null;
};

export type SlackWorkspaceSummary = {
  id: string;
  name: string;
  domain: string | null;
  iconUrl: string | null;
  enabled: boolean;
  desiredRunning: boolean;
  running: boolean;
  ready: boolean;
  botName: string | null;
  error?: string;
};

export type SlackChannelSummary = {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  memberCount: number | null;
};
