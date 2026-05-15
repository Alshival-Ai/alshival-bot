import { App } from "@slack/bolt";
import { generateAgentResponse } from "../agent.js";
import {
  getDueSlackReminders,
  getPlatformSettings,
  getSlackWorkspaceSettings,
  markReminderSent,
  saveSlackChannelMessage,
  saveSlackWorkspaceSetting,
  setDesiredRunning,
  setSlackWorkspaceDesiredRunning,
  type Reminder,
} from "../db.js";
import type {
  PlatformAdapter,
  PlatformStatus,
  SlackChannelSummary,
  SlackWorkspaceSummary,
} from "./types.js";

const slackMessageLimit = 40000;
const slackMessageTarget = 3800;

type SlackMessageEvent = {
  type?: string;
  subtype?: string;
  channel?: string;
  team?: string;
  user?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
};

type SlackWorkspaceRuntime = {
  app: App;
  workspaceId: string;
  workspaceName?: string;
  workspaceDomain?: string;
  botUserId?: string;
  displayName?: string;
  ready: boolean;
  error?: string;
};

type SlackWorkspaceStartInput = {
  workspaceId?: string;
  workspaceName?: string | null;
  workspaceDomain?: string | null;
  botToken: string;
  appToken: string;
  enabled: boolean;
  desiredRunning: boolean;
};

export class SlackPlatformAdapter implements PlatformAdapter {
  readonly platform = "slack";

  private runtimes = new Map<string, SlackWorkspaceRuntime>();
  private error: string | undefined;
  private starting: Promise<PlatformStatus> | null = null;
  private reminderInterval: NodeJS.Timeout | null = null;
  private processingReminders = false;

  status(): PlatformStatus {
    const settings = getSlackWorkspaceSettings();
    const legacySettings = getPlatformSettings(this.platform);
    const hasLegacyConnection = Boolean(legacySettings?.bot_token && legacySettings.app_token);
    const running = [...this.runtimes.values()];
    const ready = running.filter((runtime) => runtime.ready);
    const error = running.find((runtime) => runtime.error)?.error ?? this.error;

    return {
      platform: this.platform,
      configured: settings.some((setting) => Boolean(setting.bot_token && setting.app_token)) || hasLegacyConnection,
      enabled: settings.some((setting) => Boolean(setting.enabled)) || Boolean(legacySettings?.enabled),
      desiredRunning:
        settings.some((setting) => Boolean(setting.desired_running)) || Boolean(legacySettings?.desired_running),
      running: running.length > 0,
      ready: ready.length > 0,
      displayName:
        ready.length === 1
          ? ready[0].displayName
          : ready.length > 1
            ? `${ready.length} Slack workspaces`
            : undefined,
      error,
    };
  }

  async reconcile() {
    const settings = getSlackWorkspaceSettings();
    const shouldRun = settings.some(
      (setting) => setting.enabled && setting.desired_running && setting.bot_token && setting.app_token,
    );
    const legacySettings = getPlatformSettings(this.platform);
    const shouldMigrateLegacy =
      settings.length === 0 &&
      Boolean(
        legacySettings?.enabled &&
          legacySettings.desired_running &&
          legacySettings.bot_token &&
          legacySettings.app_token,
      );

    if (shouldMigrateLegacy) {
      return this.start();
    }

    if (shouldRun) {
      return this.startDesiredWorkspaces();
    }

    return this.status();
  }

  async start() {
    if (this.starting) {
      return this.starting;
    }

    this.starting = this.startInternal().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  async stop() {
    setDesiredRunning(this.platform, false);
    this.error = undefined;

    for (const setting of getSlackWorkspaceSettings()) {
      setSlackWorkspaceDesiredRunning(setting.workspace_id, false);
    }

    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }

    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.app.stop().catch(() => undefined)));
    this.runtimes.clear();

    return this.status();
  }

  async startWorkspace(workspaceId: string) {
    const setting = getSlackWorkspaceSettings().find((workspace) => workspace.workspace_id === workspaceId);

    if (!setting) {
      throw new Error(`Slack workspace ${workspaceId} is not configured.`);
    }

    setSlackWorkspaceDesiredRunning(workspaceId, true);
    await this.startRuntime({
      workspaceId: setting.workspace_id,
      workspaceName: setting.workspace_name,
      workspaceDomain: setting.workspace_domain,
      botToken: setting.bot_token ?? "",
      appToken: setting.app_token ?? "",
      enabled: Boolean(setting.enabled),
      desiredRunning: true,
    });

    return this.status();
  }

  async stopWorkspace(workspaceId: string) {
    setSlackWorkspaceDesiredRunning(workspaceId, false);
    const runtime = this.runtimes.get(workspaceId);

    if (runtime) {
      await runtime.app.stop().catch(() => undefined);
      this.runtimes.delete(workspaceId);
    }

    return this.status();
  }

  async listWorkspaces(): Promise<SlackWorkspaceSummary[]> {
    const settings = getSlackWorkspaceSettings();

    return settings.map((setting) => {
      const runtime = this.runtimes.get(setting.workspace_id);

      return {
        id: setting.workspace_id,
        name:
          runtime?.workspaceName ??
          setting.workspace_name ??
          runtime?.displayName ??
          setting.bot_name ??
          "Slack workspace",
        domain: runtime?.workspaceDomain ?? setting.workspace_domain ?? null,
        iconUrl: null,
        enabled: Boolean(setting.enabled),
        desiredRunning: Boolean(setting.desired_running),
        running: Boolean(runtime),
        ready: Boolean(runtime?.ready),
        botName: runtime?.displayName ?? setting.bot_name,
        error: runtime?.error,
      };
    });
  }

  async listChannels(workspaceId?: string): Promise<SlackChannelSummary[]> {
    const runtime = this.getRuntime(workspaceId);
    const channels: SlackChannelSummary[] = [];
    let cursor: string | undefined;

    do {
      const response = await runtime.app.client.conversations.list({
        exclude_archived: false,
        limit: 200,
        cursor,
        types: "public_channel,private_channel",
      });

      for (const channel of response.channels ?? []) {
        if (!channel.id || !channel.name) {
          continue;
        }

        channels.push({
          id: channel.id,
          name: channel.name,
          isPrivate: Boolean(channel.is_private),
          isArchived: Boolean(channel.is_archived),
          memberCount:
            typeof channel.num_members === "number" && Number.isFinite(channel.num_members)
              ? channel.num_members
              : null,
        });
      }

      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  private getRuntime(workspaceId?: string) {
    const runtime = workspaceId
      ? this.runtimes.get(workspaceId)
      : [...this.runtimes.values()].find((candidate) => candidate.ready);

    if (!runtime || !runtime.ready) {
      throw new Error(
        workspaceId
          ? `Slack workspace ${workspaceId} is not running.`
          : "Slack bot must be running before channels can be listed.",
      );
    }

    return runtime;
  }

  private splitSlackReply(text: string) {
    const gifUrls: string[] = [];
    const cleanedText = text
      .replace(/https:\/\/media\.tenor\.com\/\S+\.gif(?:\?\S*)?/gi, (url) => {
        gifUrls.push(url);
        return "";
      })
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      text: cleanedText,
      gifUrls,
    };
  }

  private findSplitIndex(text: string) {
    const max = Math.min(slackMessageTarget, text.length);
    const search = text.slice(0, max);
    const paragraph = search.lastIndexOf("\n\n");

    if (paragraph >= 300) {
      return paragraph + 2;
    }

    const sentenceMatches = [...search.matchAll(/[.!?](?:\s+|$)/g)];
    const sentence = sentenceMatches.at(-1);

    if (sentence?.index !== undefined && sentence.index >= 300) {
      return sentence.index + 1;
    }

    const newline = search.lastIndexOf("\n");
    if (newline >= 300) {
      return newline + 1;
    }

    const whitespace = search.search(/\s+\S*$/);
    if (whitespace >= 300) {
      return whitespace;
    }

    return Math.min(slackMessageTarget, slackMessageLimit);
  }

  private splitSlackText(text: string) {
    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > 0) {
      if (remaining.length <= slackMessageLimit) {
        chunks.push(remaining);
        break;
      }

      const splitIndex = this.findSplitIndex(remaining);
      const chunk = remaining.slice(0, splitIndex).trim();

      if (chunk) {
        chunks.push(chunk);
      }

      remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
  }

  private formatReminder(reminder: Reminder) {
    const lines = [
      `${reminder.authorMention ?? ""} Reminder: ${reminder.title}`.trim(),
      reminder.message,
    ].filter(Boolean);

    return lines.join("\n");
  }

  private async sendChannelMessage(workspaceId: string, channelId: string, content: string) {
    const runtime = this.getRuntime(workspaceId);

    for (const chunk of this.splitSlackText(content)) {
      await runtime.app.client.chat.postMessage({
        channel: channelId,
        text: chunk,
        unfurl_links: true,
        unfurl_media: true,
      });
    }
  }

  private startReminderJob() {
    if (this.reminderInterval) {
      return;
    }

    this.reminderInterval = setInterval(() => {
      void this.processDueReminders();
    }, 60_000);
    void this.processDueReminders();
  }

  private async processDueReminders() {
    if (this.processingReminders || this.runtimes.size === 0) {
      return;
    }

    this.processingReminders = true;

    try {
      const reminders = getDueSlackReminders(new Date().toISOString());

      for (const reminder of reminders) {
        if (!reminder.channelId || !reminder.guildId) {
          console.error(`Reminder ${reminder.id} is missing a Slack workspace or channel ID.`);
          continue;
        }

        await this.sendChannelMessage(reminder.guildId, reminder.channelId, this.formatReminder(reminder));
        markReminderSent(reminder.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Slack reminder job error.";
      this.error = message;
      console.error(`Slack reminder job error: ${message}`);
    } finally {
      this.processingReminders = false;
    }
  }

  private shouldRespond(runtime: SlackWorkspaceRuntime, message: SlackMessageEvent) {
    const text = message.text ?? "";

    if (text.toLowerCase().includes("alshival")) {
      return true;
    }

    return Boolean(runtime.botUserId && text.includes(`<@${runtime.botUserId}>`));
  }

  private async getUserDisplay(runtime: SlackWorkspaceRuntime, userId: string) {
    try {
      const result = await runtime.app.client.users.info({ user: userId });
      const user = result.user;
      const profile = user?.profile;
      const username = user?.name ?? userId;

      return {
        username,
        displayName: profile?.display_name || profile?.real_name || user?.real_name || username,
      };
    } catch {
      return {
        username: userId,
        displayName: userId,
      };
    }
  }

  private registerHandlers(app: App, runtime: SlackWorkspaceRuntime) {
    const handleSlackMessage = async (message: SlackMessageEvent) => {
      try {
        await this.handleMessage(runtime, message);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown Slack message handler error.";
        runtime.error = messageText;
        this.error = messageText;
        console.error(`Slack message handler error (${runtime.workspaceId}): ${messageText}`);
      }
    };

    app.event("app_mention", async ({ event }) => {
      await handleSlackMessage(event as SlackMessageEvent);
    });

    app.message(async ({ message }) => {
      await handleSlackMessage(message as SlackMessageEvent);
    });
  }

  private async handleMessage(runtime: SlackWorkspaceRuntime, message: SlackMessageEvent) {
    if (!runtime.ready) {
      return;
    }

    if (
      message.subtype ||
      message.bot_id ||
      !message.channel ||
      !message.user ||
      !message.text ||
      !message.ts
    ) {
      return;
    }

    if (runtime.botUserId && message.user === runtime.botUserId) {
      return;
    }

    const workspaceId = message.team ?? runtime.workspaceId;
    const sentAt = new Date(Number(message.ts.split(".")[0]) * 1000).toISOString();
    const author = await this.getUserDisplay(runtime, message.user);
    const authorMention = `<@${message.user}>`;

    const savedMessage = saveSlackChannelMessage({
      workspaceId,
      channelId: message.channel,
      messageId: message.ts,
      role: "user",
      authorId: message.user,
      authorUsername: author.username,
      authorDisplayName: author.displayName,
      authorMention,
      content: message.text,
      sentAt,
    });

    if (savedMessage.changes === 0) {
      return;
    }

    if (!this.shouldRespond(runtime, message)) {
      return;
    }

    console.log(`Slack trigger matched in workspace ${workspaceId} channel ${message.channel}`);
    const response = await generateAgentResponse({
      input: message.text,
      source: "slack",
      guildId: workspaceId,
      channelId: message.channel,
      messageId: message.ts,
      authorId: message.user,
      authorUsername: author.username,
      authorDisplayName: author.displayName,
      authorMention,
      sentAt,
    });

    const replyParts = this.splitSlackReply(response.text);
    const textChunks = this.splitSlackText(replyParts.text);
    const outboundMessages = textChunks.length > 0 ? textChunks : replyParts.gifUrls.slice(0, 1);
    let firstResponseTs: string | undefined;

    for (const chunk of outboundMessages) {
      const result = await runtime.app.client.chat.postMessage({
        channel: message.channel,
        text: chunk || "Done.",
        unfurl_links: true,
        unfurl_media: true,
      });
      firstResponseTs ??= result.ts;
    }

    const gifUrlsToSend = textChunks.length > 0 ? replyParts.gifUrls : replyParts.gifUrls.slice(1);
    for (const gifUrl of gifUrlsToSend) {
      await runtime.app.client.chat.postMessage({
        channel: message.channel,
        text: gifUrl,
        unfurl_links: true,
        unfurl_media: true,
      });
    }

    if (firstResponseTs) {
      saveSlackChannelMessage({
        workspaceId,
        channelId: message.channel,
        messageId: firstResponseTs,
        role: "assistant",
        authorId: runtime.botUserId ?? "slack-bot",
        authorUsername: runtime.displayName ?? "Alshival",
        authorDisplayName: runtime.displayName ?? "Alshival",
        authorMention: runtime.botUserId ? `<@${runtime.botUserId}>` : "@Alshival",
        content: [replyParts.text, ...replyParts.gifUrls].filter(Boolean).join("\n"),
        sentAt: new Date().toISOString(),
      });
    }
  }

  private async startInternal() {
    const settings = getSlackWorkspaceSettings();

    if (settings.length > 0) {
      for (const setting of settings) {
        if (!setting.enabled || !setting.bot_token || !setting.app_token) {
          continue;
        }

        setSlackWorkspaceDesiredRunning(setting.workspace_id, true);
        await this.startRuntime({
          workspaceId: setting.workspace_id,
          workspaceName: setting.workspace_name,
          workspaceDomain: setting.workspace_domain,
          botToken: setting.bot_token,
          appToken: setting.app_token,
          enabled: Boolean(setting.enabled),
          desiredRunning: true,
        });
      }

      return this.status();
    }

    const legacySettings = getPlatformSettings(this.platform);
    const legacyBotToken = legacySettings?.bot_token ?? "";
    const legacyAppToken = legacySettings?.app_token ?? "";

    if (!legacyBotToken || !legacyAppToken) {
      this.error = "At least one Slack workspace connection is required.";
      return this.status();
    }

    if (!legacySettings?.enabled) {
      this.error = "Slack platform is disabled.";
      return this.status();
    }

    setDesiredRunning(this.platform, true);
    await this.startRuntime({
      botToken: legacyBotToken,
      appToken: legacyAppToken,
      enabled: true,
      desiredRunning: true,
    });

    return this.status();
  }

  private async startDesiredWorkspaces() {
    for (const setting of getSlackWorkspaceSettings()) {
      if (!setting.enabled || !setting.desired_running || !setting.bot_token || !setting.app_token) {
        continue;
      }

      await this.startRuntime({
        workspaceId: setting.workspace_id,
        workspaceName: setting.workspace_name,
        workspaceDomain: setting.workspace_domain,
        botToken: setting.bot_token,
        appToken: setting.app_token,
        enabled: Boolean(setting.enabled),
        desiredRunning: Boolean(setting.desired_running),
      });
    }

    return this.status();
  }

  private async startRuntime(input: SlackWorkspaceStartInput) {
    if (!input.botToken || !input.appToken) {
      this.error = "Slack bot token and app-level Socket Mode token are required.";
      return;
    }

    if (!input.enabled) {
      this.error = "Slack workspace connection is disabled.";
      return;
    }

    const app = new App({
      token: input.botToken,
      appToken: input.appToken,
      socketMode: true,
    });

    let runtime: SlackWorkspaceRuntime | null = null;

    try {
      const auth = await app.client.auth.test();
      const workspaceId = auth.team_id ?? input.workspaceId;

      if (!workspaceId) {
        throw new Error("Slack auth.test did not return a workspace ID.");
      }

      if (input.workspaceId && input.workspaceId !== workspaceId) {
        throw new Error(`Slack bot token belongs to workspace ${workspaceId}, not ${input.workspaceId}.`);
      }

      const team = await app.client.team.info({ team: workspaceId }).catch(() => null);
      const info = team?.team as { name?: string; domain?: string } | undefined;
      const existingRuntime = this.runtimes.get(workspaceId);

      if (existingRuntime?.ready) {
        existingRuntime.error = undefined;
        return;
      }

      if (existingRuntime) {
        await existingRuntime.app.stop().catch(() => undefined);
        this.runtimes.delete(workspaceId);
      }

      runtime = {
        app,
        workspaceId,
        workspaceName: info?.name ?? auth.team ?? input.workspaceName ?? undefined,
        workspaceDomain: info?.domain ?? input.workspaceDomain ?? undefined,
        botUserId: auth.user_id,
        displayName: auth.user ?? "Alshival",
        ready: false,
      };
      this.registerHandlers(app, runtime);
      this.runtimes.set(workspaceId, runtime);

      await app.start();
      runtime.ready = true;
      runtime.error = undefined;
      this.error = undefined;

      saveSlackWorkspaceSetting({
        workspaceId,
        workspaceName: runtime.workspaceName,
        workspaceDomain: runtime.workspaceDomain,
        botToken: input.botToken,
        appToken: input.appToken,
        enabled: true,
        desiredRunning: input.desiredRunning,
        botUserId: runtime.botUserId,
        botName: runtime.displayName,
      });

      console.log(`Slack bot is online as ${runtime.displayName ?? "unknown user"} in ${workspaceId}`);
      console.log("Slack message trigger is listening for app mentions or messages containing: alshival");
      this.startReminderJob();
    } catch (error) {
      await app.stop().catch(() => undefined);

      if (runtime) {
        this.runtimes.delete(runtime.workspaceId);
      }

      const message = error instanceof Error ? error.message : "Slack login failed.";
      this.error = message;
    }
  }
}
