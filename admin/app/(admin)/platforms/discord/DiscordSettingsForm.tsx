"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, Power, Save, ShieldCheck } from "lucide-react";

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

type DiscordSettings = {
  enabled: boolean;
  desiredRunning: boolean;
  hasToken: boolean;
  tokenLast4: string | null;
  updatedAt: string | null;
  runtime: PlatformRuntimeStatus | null;
  backendReachable: boolean;
  backendError?: string;
};

const emptySettings: DiscordSettings = {
  enabled: false,
  desiredRunning: false,
  hasToken: false,
  tokenLast4: null,
  updatedAt: null,
  runtime: null,
  backendReachable: false,
};

export default function DiscordSettingsForm() {
  const [settings, setSettings] = useState<DiscordSettings>(emptySettings);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Loading Discord settings...");
  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      const response = await fetch("/api/platforms/discord");
      const data = (await response.json()) as DiscordSettings;

      if (isMounted) {
        setSettings(data);
        setStatus(getStatusCopy(data));
      }
    }

    loadSettings().catch(() => {
      if (isMounted) {
        setStatus("Could not load Discord settings.");
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus("Saving Discord settings...");

    try {
      const response = await fetch("/api/platforms/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, enabled: settings.enabled }),
      });

      if (!response.ok) {
        throw new Error("Save failed");
      }

      const data = (await response.json()) as DiscordSettings;
      setSettings(data);
      setToken("");
      setStatus(getStatusCopy(data));
    } catch {
      setStatus("Could not save Discord settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRuntimeAction(action: "start" | "stop") {
    setIsToggling(true);
    setStatus(action === "start" ? "Starting Discord bot..." : "Stopping Discord bot...");

    try {
      const response = await fetch(`/api/platforms/discord/${action}`, { method: "POST" });
      const data = (await response.json()) as PlatformRuntimeStatus | { error?: string };

      if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Runtime action failed.");
      }

      const runtimeStatus = data as PlatformRuntimeStatus;
      const nextSettings = {
        ...settings,
        runtime: runtimeStatus,
        backendReachable: true,
        backendError: undefined,
        desiredRunning: runtimeStatus.desiredRunning,
      };

      setSettings(nextSettings);
      setStatus(getStatusCopy(nextSettings));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update Discord bot runtime.");
    } finally {
      setIsToggling(false);
    }
  }

  const runtime = settings.runtime;
  const isRunning = Boolean(runtime?.running);
  const canStart = settings.backendReachable && settings.enabled && settings.hasToken && !isRunning;

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Discord</p>
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
            {isToggling && !isRunning ? "Starting..." : "Start bot"}
          </button>
          <button
            className="secondary-action fit-content"
            disabled={isToggling || !settings.backendReachable || !isRunning}
            onClick={() => void handleRuntimeAction("stop")}
            type="button"
          >
            <Power size={17} />
            {isToggling && isRunning ? "Stopping..." : "Stop bot"}
          </button>
        </div>
      </header>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Discord admin</p>
              <h3>Bot connection</h3>
            </div>
            <Bot size={21} />
          </div>
          <form className="discord-layout" onSubmit={handleSubmit}>
            <div className="connection-card">
              <div>
                <p className="eyebrow">Connection</p>
                <h4>Discord bot token</h4>
              </div>
              <label className="field">
                <span>Token</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={
                    settings.hasToken
                      ? `Saved token ending in ${settings.tokenLast4}`
                      : "Paste Discord token"
                  }
                  type="password"
                  value={token}
                />
              </label>
              <label className="toggle-row">
                <input
                  checked={settings.enabled}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, enabled: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>Enable Discord platform</span>
              </label>
              <button className="primary-action fit-content" disabled={isSaving} type="submit">
                <Save size={17} />
                {isSaving ? "Saving..." : "Save Discord settings"}
              </button>
              <p className="status-copy">{status}</p>
            </div>
          </form>
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
            The token and global running intent are stored in the local SQLite database at{" "}
            <code>./bot.db</code>. The token is not sent back to the browser after saving.
          </p>
        </section>
      </div>
    </>
  );
}

function getStatusCopy(settings: DiscordSettings) {
  if (!settings.backendReachable) {
    return settings.backendError ?? "Backend is not reachable.";
  }

  if (!settings.hasToken) {
    return "No Discord token saved yet.";
  }

  if (!settings.enabled) {
    return "Discord is configured but disabled.";
  }

  if (settings.runtime?.error) {
    return settings.runtime.error;
  }

  if (settings.runtime?.ready) {
    return settings.runtime.displayName
      ? `Discord bot is running as ${settings.runtime.displayName}.`
      : "Discord bot is running.";
  }

  if (settings.runtime?.desiredRunning) {
    return "Discord bot is set to run but is not ready yet.";
  }

  return "Discord token is saved locally.";
}
