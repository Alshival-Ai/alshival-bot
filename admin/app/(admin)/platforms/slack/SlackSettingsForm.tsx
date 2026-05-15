"use client";

import { useEffect, useState } from "react";
import { Bot, KeyRound, Power, ShieldCheck } from "lucide-react";

type PlatformRuntimeStatus = {
  platform: string;
  configured: boolean;
  enabled: boolean;
  desiredRunning: boolean;
  running: boolean;
  ready: boolean;
  displayName?: string;
  error?: string;
};

type SlackSettings = {
  workspaceCount: number;
  configuredWorkspaceCount: number;
  enabledWorkspaceCount: number;
  runtime: PlatformRuntimeStatus | null;
  backendReachable: boolean;
  backendError?: string;
};

const emptySettings: SlackSettings = {
  workspaceCount: 0,
  configuredWorkspaceCount: 0,
  enabledWorkspaceCount: 0,
  runtime: null,
  backendReachable: false,
};

export default function SlackSettingsForm() {
  const [settings, setSettings] = useState<SlackSettings>(emptySettings);
  const [status, setStatus] = useState("Loading Slack settings...");
  const [isToggling, setIsToggling] = useState(false);

  async function loadSettings() {
    const response = await fetch("/api/platforms/slack");
    const data = (await response.json()) as SlackSettings;

    if (!response.ok) {
      throw new Error("Could not load Slack settings.");
    }

    setSettings(data);
    setStatus(getStatusCopy(data));
  }

  useEffect(() => {
    let isMounted = true;

    void Promise.resolve()
      .then(loadSettings)
      .catch((error) => {
        if (isMounted) {
          setStatus(error instanceof Error ? error.message : "Could not load Slack settings.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleRuntimeAction(action: "start" | "stop") {
    setIsToggling(true);
    setStatus(action === "start" ? "Starting Slack workspaces..." : "Stopping Slack workspaces...");

    try {
      const response = await fetch(`/api/platforms/slack/${action}`, { method: "POST" });
      const data = (await response.json()) as PlatformRuntimeStatus | { error?: string };

      if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Runtime action failed.");
      }

      await loadSettings();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update Slack runtime.");
    } finally {
      setIsToggling(false);
    }
  }

  const runtime = settings.runtime;
  const isRunning = Boolean(runtime?.running);
  const canStart =
    settings.backendReachable &&
    settings.enabledWorkspaceCount > 0 &&
    settings.configuredWorkspaceCount > 0 &&
    !isRunning;

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Slack</p>
          <h2>Global Settings</h2>
        </div>
        <div className="topbar-actions">
          <button
            className="primary-action fit-content"
            disabled={isToggling || !canStart}
            onClick={() => void handleRuntimeAction("start")}
            type="button"
          >
            <Power size={17} />
            {isToggling && !isRunning ? "Starting..." : "Start enabled workspaces"}
          </button>
          <button
            className="secondary-action fit-content"
            disabled={isToggling || !settings.backendReachable || !isRunning}
            onClick={() => void handleRuntimeAction("stop")}
            type="button"
          >
            <Power size={17} />
            {isToggling && isRunning ? "Stopping..." : "Stop all"}
          </button>
        </div>
      </header>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Runtime</p>
              <h3>Workspace connections</h3>
            </div>
            <Bot size={21} />
          </div>
          <div className="connection-card">
            <div>
              <p className="eyebrow">Configured workspaces</p>
              <h4>{settings.configuredWorkspaceCount} ready</h4>
            </div>
            <p className="status-copy">{status}</p>
          </div>
        </section>

        <section className="panel compact">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Slack app setup</p>
              <h3>Per workspace tokens</h3>
            </div>
            <KeyRound size={20} />
          </div>
          <p className="placeholder-copy">
            Add each workspace from the Workspaces page. Every Slack workspace needs its own Socket Mode app token
            and bot token from the Slack app installed in that workspace.
          </p>
        </section>

        <section className="panel compact">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Local storage</p>
              <h3>bot.db</h3>
            </div>
            <ShieldCheck size={20} />
          </div>
          <p className="placeholder-copy">
            Slack workspace tokens are stored in the local SQLite database at <code>./bot.db</code>. Secrets are not
            sent back to the browser after saving.
          </p>
        </section>
      </div>
    </>
  );
}

function getStatusCopy(settings: SlackSettings) {
  if (!settings.backendReachable) {
    return settings.backendError ?? "Backend is not reachable.";
  }

  if (settings.configuredWorkspaceCount === 0) {
    return "No Slack workspace connections are configured yet.";
  }

  if (settings.runtime?.error) {
    return settings.runtime.error;
  }

  if (settings.runtime?.ready) {
    return settings.runtime.displayName
      ? `Slack is running: ${settings.runtime.displayName}.`
      : "Slack is running.";
  }

  if (settings.runtime?.desiredRunning) {
    return "Slack workspaces are set to run but are not ready yet.";
  }

  return "Slack workspace connections are saved locally.";
}
