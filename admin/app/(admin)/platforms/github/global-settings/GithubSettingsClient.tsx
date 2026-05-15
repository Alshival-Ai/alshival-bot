"use client";

import { FormEvent, useEffect, useState } from "react";
import { GitBranch, KeyRound, Save, Trash2, Upload } from "lucide-react";

type GithubAccessSettings = {
  oauthClientId: string;
  hasPersonalAccessToken: boolean;
  personalAccessTokenLast4: string | null;
  tokens: GithubAccessTokenSettings[];
  updatedAt: string | null;
};

type GithubAccessTokenSettings = {
  id: string;
  org: string;
  hasPersonalAccessToken: boolean;
  personalAccessTokenLast4: string | null;
  updatedAt: string;
};

type GithubSshKeyStatus =
  | {
      configured: true;
      privateKeyPath: string;
      publicKeyPath: string;
      publicKey: string;
      fingerprint: string;
      updatedAt: string;
    }
  | {
      configured: false;
      privateKeyPath: string;
      publicKeyPath: string;
    };

type ApiError = { error: string };

const emptyAccess: GithubAccessSettings = {
  oauthClientId: "",
  hasPersonalAccessToken: false,
  personalAccessTokenLast4: null,
  tokens: [],
  updatedAt: null,
};

export default function GithubSettingsClient() {
  const [access, setAccess] = useState<GithubAccessSettings>(emptyAccess);
  const [sshKey, setSshKey] = useState<GithubSshKeyStatus | null>(null);
  const [oauthClientId, setOauthClientId] = useState("");
  const [org, setOrg] = useState("");
  const [personalAccessToken, setPersonalAccessToken] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);
  const [status, setStatus] = useState("Loading GitHub settings...");
  const [isSaving, setIsSaving] = useState(false);

  async function loadSettings() {
    const [accessResponse, sshResponse] = await Promise.all([
      fetch("/api/settings/github-access"),
      fetch("/api/settings/github-ssh-key"),
    ]);
    const accessData = (await accessResponse.json()) as GithubAccessSettings | ApiError;
    const sshData = (await sshResponse.json()) as GithubSshKeyStatus | ApiError;

    if (!accessResponse.ok || "error" in accessData) {
      throw new Error("error" in accessData && accessData.error ? accessData.error : "Could not load GitHub access.");
    }

    if (!sshResponse.ok || "error" in sshData) {
      throw new Error("error" in sshData && sshData.error ? sshData.error : "Could not load GitHub SSH key.");
    }

    setAccess(accessData);
    setOauthClientId(accessData.oauthClientId);
    setSshKey(sshData);
    setStatus("GitHub settings loaded.");
  }

  useEffect(() => {
    void Promise.resolve()
      .then(loadSettings)
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : "Could not load GitHub settings.");
      });
  }, []);

  async function saveAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus("Saving GitHub token...");

    try {
      const response = await fetch("/api/settings/github-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oauthClientId, org, personalAccessToken }),
      });
      const data = (await response.json()) as GithubAccessSettings | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not save GitHub access.");
      }

      setAccess(data);
      setOrg("");
      setPersonalAccessToken("");
      setStatus("GitHub token saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save GitHub token.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteAccessToken(tokenId: string) {
    setIsSaving(true);
    setStatus("Deleting GitHub token...");

    try {
      const response = await fetch(`/api/settings/github-access?tokenId=${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as GithubAccessSettings | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not delete GitHub token.");
      }

      setAccess(data);
      setStatus("GitHub token deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete GitHub token.");
    } finally {
      setIsSaving(false);
    }
  }

  async function clearAccess() {
    setIsSaving(true);
    setStatus("Clearing GitHub access...");

    try {
      const response = await fetch("/api/settings/github-access", { method: "DELETE" });
      const data = (await response.json()) as GithubAccessSettings | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not clear GitHub access.");
      }

      setAccess(data);
      setOauthClientId(data.oauthClientId);
      setPersonalAccessToken("");
      setStatus("GitHub access cleared.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear GitHub access.");
    } finally {
      setIsSaving(false);
    }
  }

  async function generateSshKey() {
    setIsSaving(true);
    setStatus("Generating GitHub SSH key...");

    try {
      const response = await fetch("/api/settings/github-ssh-key/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: replaceKey }),
      });
      const data = (await response.json()) as GithubSshKeyStatus | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not generate SSH key.");
      }

      setSshKey(data);
      setStatus("GitHub SSH key generated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not generate SSH key.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadSshKey() {
    setIsSaving(true);
    setStatus("Uploading GitHub SSH key...");

    try {
      const response = await fetch("/api/settings/github-ssh-key/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privateKey, replace: replaceKey }),
      });
      const data = (await response.json()) as GithubSshKeyStatus | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not upload SSH key.");
      }

      setSshKey(data);
      setPrivateKey("");
      setStatus("GitHub SSH key uploaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not upload SSH key.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSshKey() {
    setIsSaving(true);
    setStatus("Deleting GitHub SSH key...");

    try {
      const response = await fetch("/api/settings/github-ssh-key", { method: "DELETE" });
      const data = (await response.json()) as GithubSshKeyStatus | ApiError;

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not delete SSH key.");
      }

      setSshKey(data);
      setStatus("GitHub SSH key deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete SSH key.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">GitHub</p>
          <h2>Global Settings</h2>
        </div>
      </header>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Repository access</p>
              <h3>Organization tokens</h3>
            </div>
            <GitBranch size={21} />
          </div>

          <form className="language-model-form" onSubmit={saveAccess}>
            <div className="form-grid">
              <label className="field">
                <span>OAuth client ID</span>
                <input onChange={(event) => setOauthClientId(event.target.value)} value={oauthClientId} />
              </label>
              <label className="field">
                <span>GitHub org or owner</span>
                <input
                  onChange={(event) => setOrg(event.target.value)}
                  placeholder="Alshival-Ai"
                  value={org}
                />
              </label>
              <label className="field">
                <span>Personal access token</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setPersonalAccessToken(event.target.value)}
                  placeholder="GitHub PAT for this org"
                  type="password"
                  value={personalAccessToken}
                />
              </label>
            </div>
            <div className="key-action-row">
              <button
                className="primary-action fit-content"
                disabled={isSaving || !personalAccessToken.trim()}
                type="submit"
              >
                <Save size={17} />
                Save token
              </button>
              <button className="secondary-action fit-content" disabled={isSaving} onClick={clearAccess} type="button">
                <Trash2 size={17} />
                Clear all
              </button>
            </div>
            <p className="status-copy">{status}</p>
          </form>

          <div className="settings-stack">
            <div className="connection-card">
              <div>
                <p className="eyebrow">Configured tokens</p>
                <h4>{access.tokens.length} saved</h4>
              </div>
              <p className="status-copy">
                Add one token per GitHub org or owner that Alshival should list repositories from.
              </p>
            </div>
            <div className="knowledge-source-list">
              {access.tokens.map((token) => (
                <div className="knowledge-source-row" key={token.id}>
                  <span>
                    <strong>{token.org}</strong>
                    <small>
                      {token.hasPersonalAccessToken && token.personalAccessTokenLast4
                        ? `Token ending in ${token.personalAccessTokenLast4}`
                        : "Token saved"}
                    </small>
                  </span>
                  <button
                    className="secondary-action fit-content"
                    disabled={isSaving}
                    onClick={() => void deleteAccessToken(token.id)}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Clone access</p>
              <h3>SSH Key</h3>
            </div>
            <KeyRound size={21} />
          </div>

          <div className="settings-stack">
            <div className="connection-card">
              <div>
                <p className="eyebrow">Status</p>
                <h4>{sshKey?.configured ? "SSH key configured" : "No SSH key configured"}</h4>
              </div>
              {sshKey?.configured ? (
                <>
                  <p className="status-copy">{sshKey.fingerprint}</p>
                  <textarea readOnly rows={4} value={sshKey.publicKey} />
                </>
              ) : (
                <p className="status-copy">{sshKey?.privateKeyPath ?? "Loading SSH key status..."}</p>
              )}
            </div>

            <label className="toggle-row">
              <input checked={replaceKey} onChange={(event) => setReplaceKey(event.target.checked)} type="checkbox" />
              <span>Replace existing SSH key</span>
            </label>

            <div className="button-row">
              <button className="primary-action fit-content" disabled={isSaving} onClick={generateSshKey} type="button">
                <KeyRound size={17} />
                Generate key
              </button>
              <button className="secondary-action fit-content" disabled={isSaving} onClick={deleteSshKey} type="button">
                <Trash2 size={17} />
                Delete key
              </button>
            </div>

            <label className="field">
              <span>Upload private key</span>
              <textarea
                onChange={(event) => setPrivateKey(event.target.value)}
                placeholder="Paste private key"
                rows={6}
                value={privateKey}
              />
            </label>
            <button
              className="secondary-action fit-content"
              disabled={isSaving || !privateKey.trim()}
              onClick={uploadSshKey}
              type="button"
            >
              <Upload size={17} />
              Upload key
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
