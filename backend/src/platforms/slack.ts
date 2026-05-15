import { App } from "@slack/bolt";
import { generateAgentResponse } from "../agent.js";
import {
  getDueSlackReminders,
  getPlatformSettings,
  markReminderSent,
  saveSlackChannelMessage,
  setDesiredRunning,
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

export class SlackPlatformAdapter implements PlatformAdapter {
  readonly platform = "slack";

  private app: App | null = null;
  private ready = false;
  private displayName: string | undefined;
  private workspaceId: string | undefined;
  private workspaceName: string | undefined;
  private botUserId: string | undefined;
  private error: string | undefined;
  private starting: Promise<PlatformStatus> | null = null;
  private reminderInterval: NodeJS.Timeout | null = null;
  private processingReminders = false;

  status(): PlatformStatus {
    const settings = getPlatformSettings(this.platform);
    const token = settings?.bot_token ?? "";
    const appToken = settings?.app_token ?? "";

    return {
      platform: this.platform,
      configured: token.length > 0 && appToken.length > 0,
      enabled: Boolean(settings?.enabled),
      desiredRunning: Boolean(settings?.desired_running),
      running: this.app !== null,
      ready: this.ready,
      displayName: this.displayName,
      error: this.error,
    };
  }

  async reconcile() {
    const status = this.status();

    if (status.configured && status.enabled && status.desiredRunning && !status.running) {
      return this.start();
    }

    return status;
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

    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
    }

    if (this.app) {
      await this.app.stop();
    }

    this.app = null;
    this.ready = false;
    this.displayName = undefined;
    this.workspaceId = undefined;
    this.workspaceName = undefined;
    this.botUserId = undefined;
    this.reminderInterval = null;

    return this.status();
  }

  async listWorkspaces(): Promise<SlackWorkspaceSummary[]> {
    if (!this.app || !this.ready) {
      throw new Error("Slack bot must be running before workspaces can be listed.");
    }

    const auth = await this.app.client.auth.test();
    const team = auth.team_id ? await this.app.client.team.info({ team: auth.team_id }) : null;
    const info = team?.team as
      | {
          id?: string;
          name?: string;
          domain?: string;
          icon?: { image_68?: string; image_88?: string; image_132?: string };
        }
      | undefined;

    return [
      {
        id: auth.team_id ?? this.workspaceId ?? "",
        name: info?.name ?? auth.team ?? this.workspaceName ?? "Slack workspace",
        domain: info?.domain ?? null,
        iconUrl: info?.icon?.image_132 ?? info?.icon?.image_88 ?? info?.icon?.image_68 ?? null,
      },
    ].filter((workspace) => workspace.id);
  }

  async listChannels(_workspaceId?: string): Promise<SlackChannelSummary[]> {
    if (!this.app || !this.ready) {
      throw new Error("Slack bot must be running before channels can be listed.");
    }

    const channels: SlackChannelSummary[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.app.client.conversations.list({
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

  private async sendChannelMessage(channelId: string, content: string) {
    if (!this.app) {
      throw new Error("Slack client is not running.");
    }

    for (const chunk of this.splitSlackText(content)) {
      await this.app.client.chat.postMessage({
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
    if (!this.app || !this.ready || this.processingReminders) {
      return;
    }

    this.processingReminders = true;

    try {
      const reminders = getDueSlackReminders(new Date().toISOString());

      for (const reminder of reminders) {
        if (!reminder.channelId) {
          console.error(`Reminder ${reminder.id} is missing a Slack channel ID.`);
          continue;
        }

        await this.sendChannelMessage(reminder.channelId, this.formatReminder(reminder));
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

  private shouldRespond(message: SlackMessageEvent) {
    const text = message.text ?? "";

    if (text.toLowerCase().includes("alshival")) {
      return true;
    }

    return Boolean(this.botUserId && text.includes(`<@${this.botUserId}>`));
  }

  private async getUserDisplay(userId: string) {
    if (!this.app) {
      return {
        username: userId,
        displayName: userId,
      };
    }

    try {
      const result = await this.app.client.users.info({ user: userId });
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

  private registerHandlers(app: App) {
    app.event("app_mention", async ({ event }) => {
      await this.handleMessage(event as SlackMessageEvent);
    });

    app.message(async ({ message }) => {
      await this.handleMessage(message as SlackMessageEvent);
    });
  }

  private async handleMessage(message: SlackMessageEvent) {
    if (!this.app || !this.ready) {
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

    if (this.botUserId && message.user === this.botUserId) {
      return;
    }

    const workspaceId = message.team ?? this.workspaceId;
    if (!workspaceId) {
      return;
    }

    const sentAt = new Date(Number(message.ts.split(".")[0]) * 1000).toISOString();
    const author = await this.getUserDisplay(message.user);
    const authorMention = `<@${message.user}>`;

    saveSlackChannelMessage({
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

    if (!this.shouldRespond(message)) {
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

    for (const [index, chunk] of outboundMessages.entries()) {
      const result = await this.app.client.chat.postMessage({
        channel: message.channel,
        text: chunk || "Done.",
        thread_ts: index === 0 ? message.ts : undefined,
        unfurl_links: true,
        unfurl_media: true,
      });
      firstResponseTs ??= result.ts;
    }

    const gifUrlsToSend = textChunks.length > 0 ? replyParts.gifUrls : replyParts.gifUrls.slice(1);
    for (const gifUrl of gifUrlsToSend) {
      await this.app.client.chat.postMessage({
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
        authorId: this.botUserId ?? "slack-bot",
        authorUsername: this.displayName ?? "Alshival",
        authorDisplayName: this.displayName ?? "Alshival",
        authorMention: this.botUserId ? `<@${this.botUserId}>` : "@Alshival",
        content: [replyParts.text, ...replyParts.gifUrls].filter(Boolean).join("\n"),
        sentAt: new Date().toISOString(),
      });
    }
  }

  private async startInternal() {
    const settings = getPlatformSettings(this.platform);
    const botToken = settings?.bot_token ?? "";
    const appToken = settings?.app_token ?? "";

    if (!botToken || !appToken) {
      this.error = "Slack bot token and app-level Socket Mode token are required.";
      return this.status();
    }

    if (!settings?.enabled) {
      this.error = "Slack platform is disabled.";
      return this.status();
    }

    setDesiredRunning(this.platform, true);

    if (this.app && this.ready) {
      this.error = undefined;
      return this.status();
    }

    if (this.app) {
      await this.app.stop();
    }

    this.ready = false;
    this.displayName = undefined;
    this.workspaceId = undefined;
    this.workspaceName = undefined;
    this.botUserId = undefined;
    this.error = undefined;

    const app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    this.registerHandlers(app);
    this.app = app;

    try {
      const auth = await app.client.auth.test();
      this.workspaceId = auth.team_id;
      this.workspaceName = auth.team;
      this.botUserId = auth.user_id;
      this.displayName = auth.user ?? "Alshival";
      await app.start();
      this.ready = true;
      this.error = undefined;
      console.log(`Slack bot is online as ${this.displayName ?? "unknown user"}`);
      console.log("Slack message trigger is listening for app mentions or messages containing: alshival");
      this.startReminderJob();
    } catch (error) {
      await app.stop().catch(() => undefined);
      this.app = null;
      this.ready = false;
      this.displayName = undefined;
      this.workspaceId = undefined;
      this.workspaceName = undefined;
      this.botUserId = undefined;
      this.error = error instanceof Error ? error.message : "Slack login failed.";
    }

    return this.status();
  }
}
