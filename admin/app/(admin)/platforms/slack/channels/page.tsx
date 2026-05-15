"use client";

import { useEffect, useState } from "react";
import { Hash, RefreshCw } from "lucide-react";

type SlackChannelSummary = {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  memberCount: number | null;
};

export default function SlackChannelsPage() {
  const [channels, setChannels] = useState<SlackChannelSummary[]>([]);
  const [status, setStatus] = useState("Loading Slack channels...");
  const [isLoading, setIsLoading] = useState(false);

  async function loadChannels() {
    setIsLoading(true);
    setStatus("Loading Slack channels...");

    try {
      const response = await fetch("/api/platforms/slack/channels");
      const data = (await response.json()) as { channels?: SlackChannelSummary[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load Slack channels.");
      }

      setChannels(data.channels ?? []);
      setStatus(
        data.channels?.length
          ? `${data.channels.length} channel${data.channels.length === 1 ? "" : "s"} available.`
          : "No Slack channels available yet.",
      );
    } catch (error) {
      setChannels([]);
      setStatus(error instanceof Error ? error.message : "Could not load Slack channels.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadChannels();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Slack</p>
          <h2>Channels</h2>
        </div>
        <button
          className="secondary-action fit-content"
          disabled={isLoading}
          onClick={() => void loadChannels()}
          type="button"
        >
          <RefreshCw size={17} />
          Refresh
        </button>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Channel controls</p>
            <h3>Available channels</h3>
          </div>
          <Hash size={21} />
        </div>
        <p className="status-copy">{status}</p>
        <div className="list-grid">
          {channels.map((channel) => (
            <div className="list-card" key={channel.id}>
              <div>
                <h4>#{channel.name}</h4>
                <p>
                  {channel.isPrivate ? "Private" : "Public"}
                  {channel.isArchived ? " · Archived" : ""}
                  {typeof channel.memberCount === "number" ? ` · ${channel.memberCount} members` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
