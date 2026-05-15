"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Bot, Building2, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";

type SlackWorkspaceSummary = {
  id: string;
  name: string;
  domain: string | null;
  iconUrl: string | null;
};

type GithubRepoSummary = {
  id: number;
  fullName: string;
  private: boolean;
  sshUrl: string;
  htmlUrl: string;
  updatedAt: string;
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
  const [workspaceAgentProvider, setWorkspaceAgentProvider] = useState<Provider>("openai");
  const [workspaceAgentModel, setWorkspaceAgentModel] = useState("");
  const [workspaceAgentInstructions, setWorkspaceAgentInstructions] = useState("");
  const [status, setStatus] = useState("Loading workspaces...");
  const [workspaceAgentStatus, setWorkspaceAgentStatus] = useState("Select a workspace to manage agent overrides.");
  const [historyStatus, setHistoryStatus] = useState("Clear stored memory for this workspace when needed.");
  const [knowledgeStatus, setKnowledgeStatus] = useState("Select a workspace to manage knowledge.");
  const [isLoading, setIsLoading] = useState(true);
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
    if (!selectedWorkspace || !selectedRepoFullName) {
      return;
    }

    const repo = repos.find((candidate) => candidate.fullName === selectedRepoFullName);

    if (!repo) {
      return;
    }

    setIsKnowledgeLoading(true);
    setKnowledgeStatus("Adding knowledge source...");

    try {
      const response = await fetch(`/api/platforms/slack/workspaces/${selectedWorkspace.id}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoFullName: repo.fullName,
          repoSshUrl: repo.sshUrl,
          repoHtmlUrl: repo.htmlUrl,
          private: repo.private,
        }),
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
                  <small>{workspace.domain ?? workspace.id}</small>
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
                <span>Repository</span>
                <select
                  disabled={!selectedWorkspace || isKnowledgeLoading}
                  onChange={(event) => setSelectedRepoFullName(event.target.value)}
                  value={selectedRepoFullName}
                >
                  <option value="">Select a repository</option>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.fullName}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-action fit-content"
                disabled={!selectedWorkspace || !selectedRepoFullName || isKnowledgeLoading}
                onClick={() => void addKnowledgeSource()}
                type="button"
              >
                <Plus size={17} />
                Add source
              </button>
              <p className="status-copy">{knowledgeStatus}</p>
              <div className="source-list">
                {knowledgeSources.map((source) => (
                  <div className="source-row" key={source.id}>
                    <BookOpen size={17} />
                    <span>{source.repoFullName}</span>
                    <button
                      className="icon-button"
                      disabled={isKnowledgeLoading}
                      onClick={() => void removeKnowledgeSource(source.id)}
                      type="button"
                    >
                      <Trash2 size={16} />
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
