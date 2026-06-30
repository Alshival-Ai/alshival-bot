"use client";

import { FormEvent, useEffect, useState } from "react";
import { Copy, KeyRound, Link2, Save, Trash2 } from "lucide-react";

type AsanaMcpSettings = {
  clientId: string;
  hasClientSecret: boolean;
  clientSecretLast4: string | null;
  connected: boolean;
  authorizedUserGid: string | null;
  authorizedUserName: string | null;
  authorizedUserEmail: string | null;
  accessTokenExpiresAt: string | null;
  mcpServerUrl: string;
  resourceUrl: string;
  authorizationUrl: string;
  updatedAt: string | null;
};

type ApiError = { error: string };

const emptySettings: AsanaMcpSettings = {
  clientId: "",
  hasClientSecret: false,
  clientSecretLast4: null,
  connected: false,
  authorizedUserGid: null,
  authorizedUserName: null,
  authorizedUserEmail: null,
  accessTokenExpiresAt: null,
  mcpServerUrl: "https://mcp.asana.com/v2/mcp",
  resourceUrl: "https://mcp.asana.com/v2",
  authorizationUrl: "https://app.asana.com/-/oauth_authorize",
  updatedAt: null,
};

export default function AsanaSettingsClient() {
  const [settings, setSettings] = useState<AsanaMcpSettings>(emptySettings);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [redirectUri, setRedirectUri] = useState("/api/settings/asana-mcp/callback");
  const [showNativeFlow, setShowNativeFlow] = useState(false);
  const [status, setStatus] = useState("Loading Asana settings...");
  const [isSaving, setIsSaving] = useState(false);

  async function loadSettings() {
    const response = await fetch("/api/settings/asana-mcp");
    const data = (await response.json()) as AsanaMcpSettings | ApiError;

    if (!response.ok || "error" in data) {
      throw new Error("error" in data && data.error ? data.error : "Could not load Asana MCP settings.");
    }

    setSettings(data);
    setClientId(data.clientId);
    setStatus((current) =>
      current === "Loading Asana settings..." ? "Asana MCP settings loaded." : current,
    );
  }

  useEffect(() => {
    void Promise.resolve()
      .then(async () => {
        setRedirectUri(`${window.location.origin}/api/settings/asana-mcp/callback`);

        const params = new URLSearchParams(window.location.search);
        const connected = params.get("asana_connected");
        const oauthError = params.get("asana_error");

        if (connected) {
          setStatus("Asana connected.");
        }

        if (oauthError) {
          setStatus(oauthError);
        }

        await loadSettings();
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : "Could not load Asana MCP settings.");
      });
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus("Saving Asana MCP settings...");

    try {
      const response = await fetch("/api/settings/asana-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const data = (await response.json()) as AsanaMcpSettings | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not save Asana MCP settings.");
      }

      setSettings(data);
      setClientSecret("");
      setStatus("Asana MCP settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save Asana MCP settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function clearSettings() {
    setIsSaving(true);
    setStatus("Clearing Asana MCP settings...");

    try {
      const response = await fetch("/api/settings/asana-mcp", { method: "DELETE" });
      const data = (await response.json()) as AsanaMcpSettings | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not clear Asana MCP settings.");
      }

      setSettings(data);
      setClientId(data.clientId);
      setClientSecret("");
      setStatus("Asana MCP settings cleared.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear Asana MCP settings.");
    } finally {
      setIsSaving(false);
    }
  }

  function connectAsana() {
    window.location.href = "/api/settings/asana-mcp/connect";
  }

  async function openNativeAuthorization() {
    const authorizationTab = window.open("about:blank", "_blank", "noopener,noreferrer");
    setIsSaving(true);
    setStatus("Creating Asana authorization URL...");

    try {
      const response = await fetch("/api/settings/asana-mcp/native-authorize");
      const data = (await response.json()) as { authorizationUrl?: string; error?: string };

      if (!response.ok || !data.authorizationUrl) {
        throw new Error(data.error ?? "Could not create Asana authorization URL.");
      }

      if (authorizationTab) {
        authorizationTab.location.href = data.authorizationUrl;
      } else {
        window.location.href = data.authorizationUrl;
      }
      setStatus("Paste the authorization code from Asana below.");
    } catch (error) {
      authorizationTab?.close();
      setStatus(error instanceof Error ? error.message : "Could not create Asana authorization URL.");
    } finally {
      setIsSaving(false);
    }
  }

  async function connectWithCode() {
    setIsSaving(true);
    setStatus("Connecting Asana...");

    try {
      const response = await fetch("/api/settings/asana-mcp/native-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: authorizationCode }),
      });
      const data = (await response.json()) as AsanaMcpSettings | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not connect Asana.");
      }

      setSettings(data);
      setAuthorizationCode("");
      setStatus("Asana connected.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not connect Asana.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyValue(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setStatus(`${label} copied.`);
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Asana</p>
          <h2>MCP Connector</h2>
        </div>
      </header>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Developer app</p>
              <h3>OAuth credentials</h3>
            </div>
            <KeyRound size={21} />
          </div>

          <form className="language-model-form" onSubmit={saveSettings}>
            <div className="form-grid">
              <label className="field wide">
                <span>Client ID</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setClientId(event.target.value)}
                  value={clientId}
                />
              </label>
              <label className="field wide">
                <span>Client secret</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder={
                    settings.hasClientSecret && settings.clientSecretLast4
                      ? `Saved secret ending in ${settings.clientSecretLast4}`
                      : "Asana app client secret"
                  }
                  type="password"
                  value={clientSecret}
                />
              </label>
            </div>

            <div className="key-action-row">
              <button
                className="primary-action fit-content"
                disabled={isSaving || !clientId.trim()}
                type="submit"
              >
                <Save size={17} />
                Save credentials
              </button>
              <button className="secondary-action fit-content" disabled={isSaving} onClick={clearSettings} type="button">
                <Trash2 size={17} />
                Clear
              </button>
            </div>
            <p className="status-copy">{status}</p>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">MCP server</p>
              <h3>Connection values</h3>
            </div>
          </div>

          <div className="settings-stack">
            <div className="connection-card">
              <div>
                <p className="eyebrow">Status</p>
                <h4>
                  {settings.connected
                    ? "Asana connected"
                    : settings.clientId && settings.hasClientSecret
                      ? "Ready to connect"
                      : "Credentials incomplete"}
                </h4>
              </div>
              {settings.connected ? (
                <p className="status-copy">
                  {settings.authorizedUserName ?? "Asana user"}
                  {settings.authorizedUserEmail ? ` · ${settings.authorizedUserEmail}` : ""}
                </p>
              ) : (
                <p className="status-copy">
                  Save the developer app credentials, add the redirect URI in Asana, then connect.
                </p>
              )}
              <button
                className="primary-action fit-content"
                disabled={!settings.clientId || !settings.hasClientSecret}
                onClick={connectAsana}
                type="button"
              >
                <Link2 size={17} />
                {settings.connected ? "Reconnect Asana" : "Connect Asana"}
              </button>
              <button
                className="secondary-action fit-content"
                disabled={!settings.clientId || !settings.hasClientSecret}
                onClick={() => setShowNativeFlow((current) => !current)}
                type="button"
              >
                <Link2 size={17} />
                Native app flow
              </button>
              {showNativeFlow ? (
                <div className="settings-stack">
                  <p className="status-copy">
                    Use this only if the Asana app is configured as a native or command-line app.
                  </p>
                  <button
                    className="secondary-action fit-content"
                    disabled={!settings.clientId || !settings.hasClientSecret}
                    onClick={openNativeAuthorization}
                    type="button"
                  >
                    <Link2 size={17} />
                    Authorize native app
                  </button>
                  <label className="field">
                    <span>Authorization code</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setAuthorizationCode(event.target.value)}
                      placeholder="Paste code from Asana"
                      value={authorizationCode}
                    />
                  </label>
                  <button
                    className="secondary-action fit-content"
                    disabled={!authorizationCode.trim() || isSaving}
                    onClick={connectWithCode}
                    type="button"
                  >
                    <Save size={17} />
                    Connect with code
                  </button>
                </div>
              ) : null}
            </div>

            <ConnectionValue label="Redirect URI" value={redirectUri} onCopy={copyValue} />
            <ConnectionValue label="MCP server URL" value={settings.mcpServerUrl} onCopy={copyValue} />
            <ConnectionValue label="Resource URL" value={settings.resourceUrl} onCopy={copyValue} />
            <ConnectionValue label="Authorization URL" value={settings.authorizationUrl} onCopy={copyValue} />
          </div>
        </section>
      </div>
    </>
  );
}

function ConnectionValue({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (value: string, label: string) => Promise<void>;
}) {
  return (
    <div className="key-status-card">
      <dl>
        <div>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      </dl>
      <button
        className="secondary-action fit-content compact-action"
        onClick={() => void onCopy(value, label)}
        type="button"
      >
        <Copy size={15} />
        Copy
      </button>
    </div>
  );
}
