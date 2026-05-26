import { Client, Events, GatewayIntentBits } from "discord.js";
import { generateAgentResponse } from "../agent.js";
import {
  claimDueDiscordReminders,
  getPlatformSettings,
  markReminderSent,
  releaseReminderClaim,
  saveDiscordChannelMessage,
  setDesiredRunning,
  type Reminder,
} from "../db.js";
import type { DiscordGuildSummary, PlatformAdapter, PlatformStatus } from "./types.js";

const discordMessageLimit = 2000;
const discordMessageTarget = 1900;

type DiscordMessageDelivery = {
  messageId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  sentAt: string;
};

export class DiscordPlatformAdapter implements PlatformAdapter {
  readonly platform = "discord";

  private client: Client | null = null;
  private ready = false;
  private displayName: string | undefined;
  private error: string | undefined;
  private starting: Promise<PlatformStatus> | null = null;
  private reminderInterval: NodeJS.Timeout | null = null;
  private processingReminders = false;

  status(): PlatformStatus {
    const settings = getPlatformSettings(this.platform);
    const token = settings?.bot_token ?? "";

    return {
      platform: this.platform,
      configured: token.length > 0,
      enabled: Boolean(settings?.enabled),
      desiredRunning: Boolean(settings?.desired_running),
      running: this.client !== null,
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

    if (this.client) {
      this.client.destroy();
    }

    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
    }

    this.client = null;
    this.ready = false;
    this.displayName = undefined;
    this.reminderInterval = null;

    return this.status();
  }

  listGuilds(): DiscordGuildSummary[] {
    if (!this.client || !this.ready) {
      throw new Error("Discord bot must be running before guilds can be listed.");
    }

    return this.client.guilds.cache
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount ?? null,
        iconUrl: guild.iconURL({ size: 128 }),
        available: guild.available,
        ownerId: guild.ownerId ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private splitDiscordReply(text: string) {
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
    const max = Math.min(discordMessageTarget, text.length);
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

    return Math.min(discordMessageTarget, discordMessageLimit);
  }

  private splitDiscordText(text: string) {
    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > 0) {
      if (remaining.length <= discordMessageLimit) {
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

  private async sendChannelMessage(channelId: string, content: string): Promise<DiscordMessageDelivery> {
    if (!this.client) {
      throw new Error("Discord client is not running.");
    }

    const channel = await this.client.channels.fetch(channelId);

    if (!channel || !("send" in channel) || typeof channel.send !== "function") {
      throw new Error(`Discord channel ${channelId} cannot receive messages.`);
    }

    let firstMessage: Awaited<ReturnType<typeof channel.send>> | undefined;

    for (const chunk of this.splitDiscordText(content)) {
      const sent = await channel.send(chunk);
      firstMessage ??= sent;
    }

    if (!firstMessage) {
      throw new Error(`Discord reminder delivery to channel ${channelId} did not return a message.`);
    }

    return {
      messageId: firstMessage.id,
      authorId: firstMessage.author.id,
      authorUsername: firstMessage.author.username,
      authorDisplayName: firstMessage.author.displayName ?? firstMessage.author.username,
      sentAt: firstMessage.createdAt.toISOString(),
    };
  }

  private saveReminderDelivery(reminder: Reminder, content: string, delivery: DiscordMessageDelivery) {
    if (!reminder.guildId || !reminder.channelId) {
      return;
    }

    try {
      saveDiscordChannelMessage({
        guildId: reminder.guildId,
        channelId: reminder.channelId,
        messageId: delivery.messageId,
        role: "assistant",
        authorId: delivery.authorId,
        authorUsername: delivery.authorUsername,
        authorDisplayName: delivery.authorDisplayName,
        authorMention: `<@${delivery.authorId}>`,
        content,
        sentAt: delivery.sentAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reminder history error.";
      console.error(`Discord reminder ${reminder.id} history save error: ${message}`);
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
    if (!this.client || !this.ready || this.processingReminders) {
      return;
    }

    this.processingReminders = true;

    try {
      const reminders = claimDueDiscordReminders(new Date().toISOString());

      for (const reminder of reminders) {
        try {
          if (!reminder.channelId) {
            console.error(`Reminder ${reminder.id} is missing a Discord channel ID.`);
            releaseReminderClaim(reminder.id);
            continue;
          }

          const content = this.formatReminder(reminder);
          const delivery = await this.sendChannelMessage(reminder.channelId, content);
          this.saveReminderDelivery(reminder, content, delivery);
          markReminderSent(reminder.id);
        } catch (error) {
          releaseReminderClaim(reminder.id);
          const message = error instanceof Error ? error.message : "Unknown reminder delivery error.";
          console.error(`Discord reminder ${reminder.id} delivery error: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reminder job error.";
      this.error = message;
      console.error(`Discord reminder job error: ${message}`);
    } finally {
      this.processingReminders = false;
    }
  }

  private async startInternal() {
    const settings = getPlatformSettings(this.platform);
    const token = settings?.bot_token ?? "";

    if (!token) {
      this.error = "Discord bot token is not configured.";
      return this.status();
    }

    if (!settings?.enabled) {
      this.error = "Discord platform is disabled.";
      return this.status();
    }

    setDesiredRunning(this.platform, true);

    if (this.client && this.ready) {
      this.error = undefined;
      return this.status();
    }

    if (this.client) {
      this.client.destroy();
    }

    this.ready = false;
    this.displayName = undefined;
    this.error = undefined;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.once(Events.ClientReady, (client) => {
      this.ready = true;
      this.displayName = client.user?.tag;
      this.error = undefined;
      console.log(`Discord bot is online as ${this.displayName ?? "unknown user"}`);
      console.log("Discord message trigger is listening for bot user/role mentions or messages containing: alshival");
      this.startReminderJob();
    });

    this.client.on(Events.Error, (error) => {
      this.error = error.message;
      console.error(`Discord client error: ${error.message}`);
    });

    this.client.on(Events.MessageCreate, (message) => {
      void (async () => {
        if (message.author.bot || !message.guildId) {
          return;
        }

        const sentAt = message.createdAt.toISOString();
        const authorDisplayName = message.member?.displayName ?? message.author.displayName ?? message.author.username;
        const authorMention = `<@${message.author.id}>`;

        saveDiscordChannelMessage({
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          role: "user",
          authorId: message.author.id,
          authorUsername: message.author.username,
          authorDisplayName,
          authorMention,
          content: message.content,
          sentAt,
        });

        const botUserId = this.client?.user?.id;
        const mentionsBotUser = botUserId ? message.mentions.users.has(botUserId) : false;
        const mentionsBotRole =
          message.guild?.members.me?.roles.cache.some((role) => message.mentions.roles.has(role.id)) ?? false;
        const namesBot = message.content.toLowerCase().includes("alshival");

        if (!mentionsBotUser && !mentionsBotRole && !namesBot) {
          return;
        }

        console.log(`Discord trigger matched in guild ${message.guildId ?? "dm"} channel ${message.channelId}`);
        const response = await generateAgentResponse({
          input: message.content,
          source: "discord",
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          authorId: message.author.id,
          authorUsername: message.author.username,
          authorDisplayName,
          authorMention,
          sentAt,
        });

        const replyParts = this.splitDiscordReply(response.text);
        const textChunks = this.splitDiscordText(replyParts.text);
        const outboundMessages = textChunks.length > 0 ? textChunks : replyParts.gifUrls.slice(0, 1);
        const reply = await message.reply({
          content: outboundMessages[0] || "Done.",
          allowedMentions: { parse: [], repliedUser: false },
        });
        const botUser = reply.author;

        for (const chunk of outboundMessages.slice(1)) {
          await message.channel.send({
            content: chunk,
            allowedMentions: { parse: [] },
          });
        }

        const gifUrlsToSend = textChunks.length > 0 ? replyParts.gifUrls : replyParts.gifUrls.slice(1);
        for (const gifUrl of gifUrlsToSend) {
          await message.channel.send({
            content: gifUrl,
            allowedMentions: { parse: [] },
          });
        }

        saveDiscordChannelMessage({
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: reply.id,
          role: "assistant",
          authorId: botUser.id,
          authorUsername: botUser.username,
          authorDisplayName: botUser.displayName ?? botUser.username,
          authorMention: `<@${botUser.id}>`,
          content: [replyParts.text, ...replyParts.gifUrls].filter(Boolean).join("\n"),
          sentAt: reply.createdAt.toISOString(),
        });
      })().catch((error) => {
        const messageText = error instanceof Error ? error.message : "Unknown Discord message handler error.";
        this.error = messageText;
        console.error(`Discord message handler error: ${messageText}`);
      });
    });

    try {
      await this.client.login(token);
      await this.waitForReady();
    } catch (error) {
      this.client.destroy();
      this.client = null;
      this.ready = false;
      this.displayName = undefined;
      this.error = error instanceof Error ? error.message : "Discord login failed.";
    }

    return this.status();
  }

  private waitForReady() {
    if (this.ready) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.client?.off(Events.ClientReady, handleReady);
        reject(new Error("Discord login timed out before the bot became ready."));
      }, 20_000);

      const handleReady = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.client?.once(Events.ClientReady, handleReady);
    });
  }
}
