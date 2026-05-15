"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Bot, Building2, KeyRound, Plus, Power, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";

type SlackWorkspaceSummary = {
  id: string;
  name: string;
  domain: string | null;
  iconUrl: string | null;
  enabled: boolean;
  desiredRunning: boolean;
  running: boolean;
  ready: boolean;
  botName: string | null;
  error?: string;
};

type GithubRepoSummary = {
  id: number;
  fullName: string;
  private: boolean;
  sshUrl: string;
  htmlUrl: string;
  updatedAt: string;
  accessOrg: string;
};

type WorkspaceKnowledgeSource = {
  id: number;
  platform: "github";
  repoFullName: string;
  repoSshUrl: string;
  repoHtmlUrl: string;
  private: boolean;
  createdAt: string;
};

type Provider = "openai" | "anthropic";

type WorkspaceAgentConfig = {
  provider: Provider;
  model: string;
  instructions: string;
  updatedAt: string | null;
  inheritsDefault: boolean;
};

export default function SlackWorkspacesClient() {
  const [workspaces, setWorkspaces] = useState<SlackWorkspaceSummary[]>([]);
  const [repos, setRepos] = useState<GithubRepoSummary[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<WorkspaceKnowledgeSource[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [knowledgeSourceMode, setKnowledgeSourceMode] = useState<"select" | "remote">("select");
  const [remoteOrigin, setRemoteOrigin] = useState("");
  const [workspaceAgentProvider, setWorkspaceAgentProvider] = useState<Provider>("openai");
  const [workspaceAgentModel, setWorkspaceAgentModel] = useState("");
  const [workspaceAgentInstructions, setWorkspaceAgentInstructions] = useState("");
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [connectionEnabled, setConnectionEnabled] = useState(true);
  const [status, setStatus] = useState("Loading workspaces...");
  const [connectionStatus, setConnectionStatus] = useState("Add a Slack workspace connection.");
  const [runtimeStatus, setRuntimeStatus] = useState("Select a workspace to manage its Slack runtime.");
  const [workspaceAgentStatus, setWorkspaceAgentStatus] = useState("Select a workspace to manage agent overrides.");
  const [historyStatus, setHistoryStatus] = useState("Clear stored memory for this workspace when needed.");
  const [knowledgeStatus, setKnowledgeStatus] = useState("Select a workspace to manage knowledge.");
  const [isLoading, setIsLoading] = useState(true);
  const [isConnectionSaving, setIsConnectionSaving] = useState(false);
  const [isRuntimeUpdating, setIsRuntimeUpdating] = useState(false);
  const [isWorkspaceAgentSaving, setIsWorkspaceAgentSaving] = useState(false);
  const [isHistoryClearing, setIsHistoryClearing] = useState(false);
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);

  const selectedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      workspaces[0] ??
      null,
    [workspaces, selectedWorkspaceId],
  );

  async function loadWorkspaces() {
    setIsLoading(true);
    setStatus("Loading workspaces...");

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
          : nextWorkspaces[0]?.id ?? null,
      );
      setStatus(
        nextWorkspaces.length > 0
          ? `${nextWorkspaces.length} workspace${nextWorkspaces.length === 1 ? "" : "s"} available.`
          : "Slack is not connected to a workspace yet.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load Slack workspaces.");
      setWorkspaces([]);
      setSelectedWorkspaceId(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadRepos() {
    const response = await fetch("/api/platforms/github/repos");
    const data = (await response.json()) as { repos?: GithubRepoSummary[]; error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? "Could not load GitHub repos.");
    }

    setRepos(data.repos ?? []);
  }

  async function saveWorkspaceConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsConnectionSaving(true);
    setConnectionStatus("Saving Slack workspace connection...");

    try {
      const response = await fetch("/api/platforms/slack/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken,
          appToken,
          enabled: connectionEnabled,
          start: true,
        }),
      });
      const data = (await response.json()) as {
        workspace?: { workspaceId: string; workspaceName: string | null };
        workspaces?: SlackWorkspaceSummary[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not save Slack workspace connection.");
      }

      setBotToken("");
      setAppToken("");
      setWorkspaces(data.workspaces ?? []);
      setSelectedWorkspaceId(data.workspace?.workspaceId ?? data.workspaces?.[0]?.id ?? null);
      setRuntimeStatus("Slack workspace connection saved.");
      setConnectionStatus(
        data.workspace?.workspaceName
          ? `${data.workspace.workspaceName} connected.`
          : "Slack workspace connected.",
      );
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : "Could not save Slack workspace connection.");
    } finally {
      setIsConnectionSaving(false);
    }
  }

  async function updateWorkspaceRuntime(action: "start" | "stop") {
    if (!selectedWorkspace) {
      return;
    }

    setIsRuntimeUpdating(true);
    setRuntimeStatus(action === "start" ? "Starting Slack workspace..." : "Stopping Slack workspace...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not update Slack workspace runtime.");
      }

      await loadWorkspaces();
      setRuntimeStatus(action === "start" ? "Slack workspace started." : "Slack workspace stopped.");
    } catch (error) {
      setRuntimeStatus(error instanceof Error ? error.message : "Could not update Slack workspace runtime.");
    } finally {
      setIsRuntimeUpdating(false);
    }
  }

  async function updateWorkspaceEnabled(enabled: boolean) {
    if (!selectedWorkspace) {
      return;
    }

    setIsRuntimeUpdating(true);
    setRuntimeStatus(enabled ? "Enabling Slack workspace..." : "Disabling Slack workspace...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not update Slack workspace settings.");
      }

      await loadWorkspaces();
      setRuntimeStatus(enabled ? "Slack workspace enabled." : "Slack workspace disabled.");
    } catch (error) {
      setRuntimeStatus(error instanceof Error ? error.message : "Could not update Slack workspace settings.");
    } finally {
      setIsRuntimeUpdating(false);
    }
  }

  async function deleteWorkspaceConnection() {
    if (!selectedWorkspace) {
      return;
    }

    const confirmed = window.confirm(
      `Delete the Slack connection for ${selectedWorkspace.name}? Tokens and runtime state will be removed.`,
    );

    if (!confirmed) {
      return;
    }

    setIsRuntimeUpdating(true);
    setRuntimeStatus("Deleting Slack workspace connection...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/settings`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete Slack workspace settings.");
      }

      setKnowledgeSources([]);
      await loadWorkspaces();
      setRuntimeStatus("Slack workspace connection deleted.");
    } catch (error) {
      setRuntimeStatus(error instanceof Error ? error.message : "Could not delete Slack workspace settings.");
    } finally {
      setIsRuntimeUpdating(false);
    }
  }

  async function loadKnowledgeSources(workspaceId: string) {
    setIsKnowledgeLoading(true);
    setKnowledgeStatus("Loading knowledge sources...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${workspaceId}/knowledge`);
      const data = (await response.json()) as {
        sources?: WorkspaceKnowledgeSource[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load knowledge sources.");
      }

      setKnowledgeSources(data.sources ?? []);
      setKnowledgeStatus(
        data.sources?.length
          ? `${data.sources.length} knowledge source${data.sources.length === 1 ? "" : "s"} configured.`
          : "No knowledge sources configured for this workspace yet.",
      );
    } catch (error) {
      setKnowledgeSources([]);
      setKnowledgeStatus(error instanceof Error ? error.message : "Could not load knowledge sources.");
    } finally {
      setIsKnowledgeLoading(false);
    }
  }

  async function loadWorkspaceAgentConfig(workspaceId: string) {
    setWorkspaceAgentStatus("Loading workspace agent settings...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${workspaceId}/agent`);
      const data = (await response.json()) as WorkspaceAgentConfig | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not load workspace agent settings.");
      }

      const nextConfig = data as WorkspaceAgentConfig;
      setWorkspaceAgentProvider(nextConfig.provider);
      setWorkspaceAgentModel(nextConfig.model);
      setWorkspaceAgentInstructions(nextConfig.instructions);
      setWorkspaceAgentStatus(
        nextConfig.inheritsDefault
          ? "This workspace is using the default Agent settings."
          : "This workspace has custom Agent settings.",
      );
    } catch (error) {
      setWorkspaceAgentStatus(error instanceof Error ? error.message : "Could not load workspace agent settings.");
    }
  }

  async function saveWorkspaceAgentConfig() {
    if (!selectedWorkspace) {
      return;
    }

    setIsWorkspaceAgentSaving(true);
    setWorkspaceAgentStatus("Saving workspace agent settings...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: workspaceAgentProvider,
          model: workspaceAgentModel,
          instructions: workspaceAgentInstructions,
        }),
      });
      const data = (await response.json()) as WorkspaceAgentConfig | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not save workspace agent settings.");
      }

      const nextConfig = data as WorkspaceAgentConfig;
      setWorkspaceAgentProvider(nextConfig.provider);
      setWorkspaceAgentModel(nextConfig.model);
      setWorkspaceAgentInstructions(nextConfig.instructions);
      setWorkspaceAgentStatus("Workspace agent settings saved.");
    } catch (error) {
      setWorkspaceAgentStatus(error instanceof Error ? error.message : "Could not save workspace agent settings.");
    } finally {
      setIsWorkspaceAgentSaving(false);
    }
  }

  async function clearWorkspaceAgentConfig() {
    if (!selectedWorkspace) {
      return;
    }

    setIsWorkspaceAgentSaving(true);
    setWorkspaceAgentStatus("Clearing workspace agent override...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/agent`, {
        method: "DELETE",
      });
      const data = (await response.json()) as WorkspaceAgentConfig | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not clear workspace agent settings.");
      }

      const nextConfig = data as WorkspaceAgentConfig;
      setWorkspaceAgentProvider(nextConfig.provider);
      setWorkspaceAgentModel(nextConfig.model);
      setWorkspaceAgentInstructions(nextConfig.instructions);
      setWorkspaceAgentStatus("Workspace agent override cleared. This workspace is using the default Agent settings.");
    } catch (error) {
      setWorkspaceAgentStatus(error instanceof Error ? error.message : "Could not clear workspace agent settings.");
    } finally {
      setIsWorkspaceAgentSaving(false);
    }
  }

  async function clearWorkspaceHistory() {
    if (!selectedWorkspace) {
      return;
    }

    const confirmed = window.confirm(
      `Clear all stored chat history for ${selectedWorkspace.name}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setIsHistoryClearing(true);
    setHistoryStatus("Clearing stored chat history...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/history`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { deletedMessages?: number; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not clear chat history.");
      }

      const deletedMessages = data.deletedMessages ?? 0;
      setHistoryStatus(
        `Cleared ${deletedMessages} stored message${deletedMessages === 1 ? "" : "s"} for this workspace.`,
      );
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : "Could not clear chat history.");
    } finally {
      setIsHistoryClearing(false);
    }
  }

  async function addKnowledgeSource() {
    if (!selectedWorkspace) {
      return;
    }

    const repo =
      knowledgeSourceMode === "select"
        ? repos.find((candidate) => candidate.fullName === selectedRepoFullName)
        : null;

    if (knowledgeSourceMode === "select" && !repo) {
      return;
    }

    if (knowledgeSourceMode === "remote" && !remoteOrigin.trim()) {
      return;
    }

    setIsKnowledgeLoading(true);
    setKnowledgeStatus("Adding knowledge source...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          repo
            ? {
                repoFullName: repo.fullName,
                repoSshUrl: repo.sshUrl,
                repoHtmlUrl: repo.htmlUrl,
                private: repo.private,
              }
            : {
                remoteOrigin,
                private: true,
              },
        ),
      });
      const data = (await response.json()) as {
        sources?: WorkspaceKnowledgeSource[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not add knowledge source.");
      }

      setKnowledgeSources(data.sources ?? []);
      setSelectedRepoFullName("");
      setRemoteOrigin("");
      setKnowledgeStatus("Knowledge source added.");
    } catch (error) {
      setKnowledgeStatus(error instanceof Error ? error.message : "Could not add knowledge source.");
    } finally {
      setIsKnowledgeLoading(false);
    }
  }

  async function removeKnowledgeSource(sourceId: number) {
    if (!selectedWorkspace) {
      return;
    }

    setIsKnowledgeLoading(true);
    setKnowledgeStatus("Removing knowledge source...");

    try {
      const response = await fetch(
        `/api/platforms/slack/workspaces/${selectedWorkspace.id}/knowledge?sourceId=${sourceId}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as {
        sources?: WorkspaceKnowledgeSource[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not remove knowledge source.");
      }

      setKnowledgeSources(data.sources ?? []);
      setKnowledgeStatus("Knowledge source removed.");
    } catch (error) {
      setKnowledgeStatus(error instanceof Error ? error.message : "Could not remove knowledge source.");
    } finally {
      setIsKnowledgeLoading(false);
    }
  }

  useEffect(() => {
    async function loadInitialWorkspaces() {
      await loadWorkspaces();
      await loadRepos();
    }

    void loadInitialWorkspaces();
  }, []);

  useEffect(() => {
    if (selectedWorkspace?.id) {
      void Promise.resolve().then(async () => {
        await loadKnowledgeSources(selectedWorkspace.id);
        await loadWorkspaceAgentConfig(selectedWorkspace.id);
      });
    }
  }, [selectedWorkspace?.id]);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Slack</p>
          <h2>Workspaces</h2>
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

      <div className="guild-admin-layout">
        <section className="panel guild-list-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Connected Slack</p>
              <h3>Workspaces</h3>
            </div>
            <Building2 size={21} />
          </div>
          <p className="status-copy">{status}</p>
          <form className="settings-stack" onSubmit={saveWorkspaceConnection}>
            <div className="connection-card">
              <div>
                <p className="eyebrow">Connection</p>
                <h4>Add workspace</h4>
              </div>
              <label className="field">
                <span>Bot token</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setBotToken(event.target.value)}
                  placeholder="Paste xoxb bot token"
                  type="password"
                  value={botToken}
                />
              </label>
              <label className="field">
                <span>Socket Mode app token</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setAppToken(event.target.value)}
                  placeholder="Paste xapp app-level token"
                  type="password"
                  value={appToken}
                />
              </label>
              <label className="toggle-row">
                <input
                  checked={connectionEnabled}
                  onChange={(event) => setConnectionEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span>Enable this workspace</span>
              </label>
              <button
                className="primary-action fit-content"
                disabled={isConnectionSaving || !botToken.trim() || !appToken.trim()}
                type="submit"
              >
                <KeyRound size={17} />
                {isConnectionSaving ? "Saving..." : "Save workspace"}
              </button>
              <p className="status-copy">{connectionStatus}</p>
            </div>
          </form>
          <div className="guild-list">
            {workspaces.map((workspace) => (
              <button
                className={`guild-row ${selectedWorkspace?.id === workspace.id ? "active" : ""}`}
                key={workspace.id}
                onClick={() => setSelectedWorkspaceId(workspace.id)}
                type="button"
              >
                {workspace.iconUrl ? (
                  <Image
                    alt=""
                    className="guild-icon"
                    height={38}
                    src={workspace.iconUrl}
                    unoptimized
                    width={38}
                  />
                ) : (
                  <span className="guild-avatar">{workspace.name.slice(0, 1).toUpperCase()}</span>
                )}
                <span>
                  <strong>{workspace.name}</strong>
                  <small>
                    {workspace.ready
                      ? "Running"
                      : workspace.enabled
                        ? "Stopped"
                        : "Disabled"}{" "}
                    · {workspace.domain ?? workspace.id}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel workspace-detail-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Workspace configuration</p>
              <h3>{selectedWorkspace?.name ?? "Select a workspace"}</h3>
            </div>
            <Bot size={21} />
          </div>

          <div className="settings-stack">
            <div className="connection-card">
              <div>
                <p className="eyebrow">Connection</p>
                <h4>
                  {selectedWorkspace?.ready
                    ? "Running"
                    : selectedWorkspace?.enabled
                      ? "Stopped"
                      : selectedWorkspace
                        ? "Disabled"
                        : "No workspace selected"}
                </h4>
              </div>
              <p className="placeholder-copy">
                {selectedWorkspace?.botName
                  ? `Bot user: ${selectedWorkspace.botName}`
                  : selectedWorkspace?.error ?? "Manage this workspace's Slack app connection."}
              </p>
              <div className="button-row">
                <button
                  className="primary-action fit-content"
                  disabled={!selectedWorkspace || !selectedWorkspace.enabled || selectedWorkspace.ready || isRuntimeUpdating}
                  onClick={() => void updateWorkspaceRuntime("start")}
                  type="button"
                >
                  <Power size={17} />
                  Start
                </button>
                <button
                  className="secondary-action fit-content"
                  disabled={!selectedWorkspace || !selectedWorkspace.running || isRuntimeUpdating}
                  onClick={() => void updateWorkspaceRuntime("stop")}
                  type="button"
                >
                  <Power size={17} />
                  Stop
                </button>
                <button
                  className="secondary-action fit-content"
                  disabled={!selectedWorkspace || isRuntimeUpdating}
                  onClick={() => void updateWorkspaceEnabled(!selectedWorkspace.enabled)}
                  type="button"
                >
                  <KeyRound size={17} />
                  {selectedWorkspace?.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="secondary-action fit-content"
                  disabled={!selectedWorkspace || isRuntimeUpdating}
                  onClick={() => void deleteWorkspaceConnection()}
                  type="button"
                >
                  <Trash2 size={17} />
                  Delete
                </button>
              </div>
              <p className="status-copy">{runtimeStatus}</p>
            </div>

            <div className="connection-card">
              <div>
                <p className="eyebrow">Agent override</p>
                <h4>Workspace defaults</h4>
              </div>
              <label className="field">
                <span>Provider</span>
                <select
                  onChange={(event) => setWorkspaceAgentProvider(event.target.value as Provider)}
                  value={workspaceAgentProvider}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label className="field">
                <span>Model ID</span>
                <input
                  onChange={(event) => setWorkspaceAgentModel(event.target.value)}
                  placeholder="gpt-5.5"
                  value={workspaceAgentModel}
                />
              </label>
              <label className="field">
                <span>Instructions</span>
                <textarea
                  onChange={(event) => setWorkspaceAgentInstructions(event.target.value)}
                  rows={5}
                  value={workspaceAgentInstructions}
                />
              </label>
              <div className="button-row">
                <button
                  className="primary-action fit-content"
                  disabled={!selectedWorkspace || isWorkspaceAgentSaving}
                  onClick={() => void saveWorkspaceAgentConfig()}
                  type="button"
                >
                  <Save size={17} />
                  Save override
                </button>
                <button
                  className="secondary-action fit-content"
                  disabled={!selectedWorkspace || isWorkspaceAgentSaving}
                  onClick={() => void clearWorkspaceAgentConfig()}
                  type="button"
                >
                  <RotateCcw size={17} />
                  Use default
                </button>
              </div>
              <p className="status-copy">{workspaceAgentStatus}</p>
            </div>

            <div className="connection-card">
              <div>
                <p className="eyebrow">Memory</p>
                <h4>Chat history</h4>
              </div>
              <button
                className="secondary-action fit-content"
                disabled={!selectedWorkspace || isHistoryClearing}
                onClick={() => void clearWorkspaceHistory()}
                type="button"
              >
                <Trash2 size={17} />
                Clear history
              </button>
              <p className="status-copy">{historyStatus}</p>
            </div>

            <div className="connection-card">
              <div>
                <p className="eyebrow">Knowledge</p>
                <h4>GitHub sources</h4>
              </div>
              <label className="field">
                <span>Source</span>
                <select
                  disabled={!selectedWorkspace || isKnowledgeLoading}
                  onChange={(event) => setKnowledgeSourceMode(event.target.value as "select" | "remote")}
                  value={knowledgeSourceMode}
                >
                  <option value="select">Select a repository</option>
                  <option value="remote">Add remote origin</option>
                </select>
              </label>
              {knowledgeSourceMode === "select" ? (
                <label className="field">
                  <span>Repository</span>
                  <select
                    disabled={!selectedWorkspace || isKnowledgeLoading}
                    onChange={(event) => setSelectedRepoFullName(event.target.value)}
                    value={selectedRepoFullName}
                  >
                    <option value="">Select a repository</option>
                    {repos.map((repo) => (
                      <option key={repo.id} value={repo.fullName}>
                        {repo.fullName} · {repo.accessOrg}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="field">
                  <span>Remote origin</span>
                  <input
                    disabled={!selectedWorkspace || isKnowledgeLoading}
                    onChange={(event) => setRemoteOrigin(event.target.value)}
                    placeholder="https://github.com/org/repo.git"
                    value={remoteOrigin}
                  />
                </label>
              )}
              <button
                className="primary-action fit-content"
                disabled={
                  !selectedWorkspace ||
                  isKnowledgeLoading ||
                  (knowledgeSourceMode === "select"
                    ? !selectedRepoFullName
                    : remoteOrigin.trim().length === 0)
                }
                onClick={() => void addKnowledgeSource()}
                type="button"
              >
                <Plus size={17} />
                Add source
              </button>
              {knowledgeSourceMode === "remote" ? (
                <p className="status-copy">
                  Remote origins are normalized to SSH and cloned with the configured GitHub SSH key.
                </p>
              ) : null}
              <p className="status-copy">{knowledgeStatus}</p>
              <div className="knowledge-source-list">
                {knowledgeSources.map((source) => (
                  <div className="knowledge-source-row" key={source.id}>
                    <span>{source.repoFullName}</span>
                    <button
                      className="secondary-action fit-content"
                      disabled={isKnowledgeLoading}
                      onClick={() => void removeKnowledgeSource(source.id)}
                      type="button"
                    >
                      <Trash2 size={16} />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
