"use client";

import { useCallback, useEffect, useState } from "react";
import { Hash, RefreshCw } from "lucide-react";

type SlackWorkspaceSummary = {
  id: string;
  name: string;
  domain: string | null;
  enabled: boolean;
  ready: boolean;
};

type SlackChannelSummary = {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  memberCount: number | null;
};

export default function SlackChannelsPage() {
  const [workspaces, setWorkspaces] = useState<SlackWorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [channels, setChannels] = useState<SlackChannelSummary[]>([]);
  const [status, setStatus] = useState("Loading Slack channels...");
  const [isLoading, setIsLoading] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setStatus("Loading Slack workspaces...");

    try {
      const response = await fetch("/api/platforms/slack/workspaces");
      const data = (await response.json()) as { workspaces?: SlackWorkspaceSummary[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load Slack workspaces.");
      }

      const nextWorkspaces = data.workspaces ?? [];
      setWorkspaces(nextWorkspaces);
      setSelectedWorkspaceId((current) =>
        current && nextWorkspaces.some((workspace) => workspace.id === current)
          ? current
          : nextWorkspaces[0]?.id ?? "",
      );

      if (nextWorkspaces.length === 0) {
        setChannels([]);
        setStatus("No Slack workspaces are configured yet.");
      }
    } catch (error) {
      setWorkspaces([]);
      setSelectedWorkspaceId("");
      setChannels([]);
      setStatus(error instanceof Error ? error.message : "Could not load Slack workspaces.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadChannels = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setChannels([]);
      setStatus("Select a Slack workspace to view channels.");
      return;
    }

    setIsLoading(true);
    setStatus("Loading Slack channels...");

    try {
      const response = await fetch(`/api/platforms/slack/channels?workspaceId=${encodeURIComponent(workspaceId)}`);
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
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadWorkspaces();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadChannels(selectedWorkspaceId);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadChannels, selectedWorkspaceId]);

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
          onClick={() => void loadWorkspaces()}
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
        <label className="field">
          <span>Workspace</span>
          <select
            disabled={isLoading || workspaces.length === 0}
            onChange={(event) => setSelectedWorkspaceId(event.target.value)}
            value={selectedWorkspaceId}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
                {workspace.ready ? " (running)" : workspace.enabled ? " (stopped)" : " (disabled)"}
              </option>
            ))}
          </select>
        </label>
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
