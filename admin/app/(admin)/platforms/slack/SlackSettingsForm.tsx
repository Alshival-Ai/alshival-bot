"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, KeyRound, Power, Save, ShieldCheck } from "lucide-react";

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
  enabled: boolean;
  desiredRunning: boolean;
  hasBotToken: boolean;
  botTokenLast4: string | null;
  hasAppToken: boolean;
  appTokenLast4: string | null;
  updatedAt: string | null;
  runtime: PlatformRuntimeStatus | null;
  backendReachable: boolean;
  backendError?: string;
};

const emptySettings: SlackSettings = {
  enabled: false,
  desiredRunning: false,
  hasBotToken: false,
  botTokenLast4: null,
  hasAppToken: false,
  appTokenLast4: null,
  updatedAt: null,
  runtime: null,
  backendReachable: false,
};

export default function SlackSettingsForm() {
  const [settings, setSettings] = useState<SlackSettings>(emptySettings);
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [status, setStatus] = useState("Loading Slack settings...");
  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      const response = await fetch("/api/platforms/slack");
      const data = (await response.json()) as SlackSettings;

      if (isMounted) {
        setSettings(data);
        setStatus(getStatusCopy(data));
      }
    }

    loadSettings().catch(() => {
      if (isMounted) {
        setStatus("Could not load Slack settings.");
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus("Saving Slack settings...");

    try {
      const response = await fetch("/api/platforms/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, appToken, enabled: settings.enabled }),
      });

      if (!response.ok) {
        throw new Error("Save failed");
      }

      const data = (await response.json()) as SlackSettings;
      setSettings(data);
      setBotToken("");
      setAppToken("");
      setStatus(getStatusCopy(data));
    } catch {
      setStatus("Could not save Slack settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRuntimeAction(action: "start" | "stop") {
    setIsToggling(true);
    setStatus(action === "start" ? "Starting Slack bot..." : "Stopping Slack bot...");

    try {
      const response = await fetch(`/api/platforms/slack/${action}`, { method: "POST" });
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
      setStatus(error instanceof Error ? error.message : "Could not update Slack bot runtime.");
    } finally {
      setIsToggling(false);
    }
  }

  const runtime = settings.runtime;
  const isRunning = Boolean(runtime?.running);
  const canStart =
    settings.backendReachable &&
    settings.enabled &&
    settings.hasBotToken &&
    settings.hasAppToken &&
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
              <p className="eyebrow">Slack admin</p>
              <h3>Socket Mode connection</h3>
            </div>
            <Bot size={21} />
          </div>
          <form className="discord-layout" onSubmit={handleSubmit}>
            <div className="connection-card">
              <div>
                <p className="eyebrow">Connection</p>
                <h4>Slack tokens</h4>
              </div>
              <label className="field">
                <span>Bot token</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setBotToken(event.target.value)}
                  placeholder={
                    settings.hasBotToken
                      ? `Saved bot token ending in ${settings.botTokenLast4}`
                      : "Paste xoxb bot token"
                  }
                  type="password"
                  value={botToken}
                />
              </label>
              <label className="field">
                <span>Socket Mode app token</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setAppToken(event.target.value)}
                  placeholder={
                    settings.hasAppToken
                      ? `Saved app token ending in ${settings.appTokenLast4}`
                      : "Paste xapp app-level token"
                  }
                  type="password"
                  value={appToken}
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
                <span>Enable Slack platform</span>
              </label>
              <button className="primary-action fit-content" disabled={isSaving} type="submit">
                <Save size={17} />
                {isSaving ? "Saving..." : "Save Slack settings"}
              </button>
              <p className="status-copy">{status}</p>
            </div>
          </form>
        </section>

        <section className="panel compact">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Slack app setup</p>
              <h3>Required access</h3>
            </div>
            <KeyRound size={20} />
          </div>
          <p className="placeholder-copy">
            Enable Socket Mode in Slack, create an app-level token with <code>connections:write</code>,
            and install a bot token with message, channel, user, team, and chat write scopes.
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
            Slack tokens and runtime intent are stored in the local SQLite database at{" "}
            <code>./bot.db</code>. Secrets are not sent back to the browser after saving.
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

  if (!settings.hasBotToken || !settings.hasAppToken) {
    return "Slack bot token and Socket Mode app token are required.";
  }

  if (!settings.enabled) {
    return "Slack is configured but disabled.";
  }

  if (settings.runtime?.error) {
    return settings.runtime.error;
  }

  if (settings.runtime?.ready) {
    return settings.runtime.displayName
      ? `Slack bot is running as ${settings.runtime.displayName}.`
      : "Slack bot is running.";
  }

  if (settings.runtime?.desiredRunning) {
    return "Slack bot is set to run but is not ready yet.";
  }

  return "Slack tokens are saved locally.";
}
