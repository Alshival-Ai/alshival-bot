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
