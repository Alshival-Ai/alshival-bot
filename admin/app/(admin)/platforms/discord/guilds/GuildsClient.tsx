"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Bot, Building2, Plus, RefreshCw, RotateCcw, Save, Server, Trash2 } from "lucide-react";

type DiscordGuildSummary = {
  id: string;
  name: string;
  memberCount: number | null;
  iconUrl: string | null;
  available: boolean;
  ownerId: string | null;
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

type GuildKnowledgeSource = {
  id: number;
  platform: "github";
  repoFullName: string;
  repoSshUrl: string;
  repoHtmlUrl: string;
  indexedAt: string | null;
  indexedMarkdownFiles: number;
  private: boolean;
  createdAt: string;
};

type Provider = "openai" | "anthropic";

type GuildAgentConfig = {
  provider: Provider;
  model: string;
  instructions: string;
  updatedAt: string | null;
  inheritsDefault: boolean;
};

export default function GuildsClient() {
  const [guilds, setGuilds] = useState<DiscordGuildSummary[]>([]);
  const [repos, setRepos] = useState<GithubRepoSummary[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<GuildKnowledgeSource[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [knowledgeSourceMode, setKnowledgeSourceMode] = useState<"select" | "remote">("select");
  const [remoteOrigin, setRemoteOrigin] = useState("");
  const [guildAgentConfig, setGuildAgentConfig] = useState<GuildAgentConfig | null>(null);
  const [guildAgentProvider, setGuildAgentProvider] = useState<Provider>("openai");
  const [guildAgentModel, setGuildAgentModel] = useState("");
  const [guildAgentInstructions, setGuildAgentInstructions] = useState("");
  const [status, setStatus] = useState("Loading guilds...");
  const [guildAgentStatus, setGuildAgentStatus] = useState("Select a guild to manage agent overrides.");
  const [historyStatus, setHistoryStatus] = useState("Clear stored memory for this guild when needed.");
  const [knowledgeStatus, setKnowledgeStatus] = useState("Select a guild to manage knowledge.");
  const [isLoading, setIsLoading] = useState(true);
  const [isGuildAgentSaving, setIsGuildAgentSaving] = useState(false);
  const [isHistoryClearing, setIsHistoryClearing] = useState(false);
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) ?? guilds[0] ?? null,
    [guilds, selectedGuildId],
  );

  async function loadGuilds() {
    setIsLoading(true);
    setStatus("Loading guilds...");

    try {
      const response = await fetch("/api/platforms/discord/guilds");
      const data = (await response.json()) as { guilds?: DiscordGuildSummary[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load Discord guilds.");
      }

      const nextGuilds = data.guilds ?? [];
      setGuilds(nextGuilds);
      setSelectedGuildId((current) =>
        current && nextGuilds.some((guild) => guild.id === current)
          ? current
          : nextGuilds[0]?.id ?? null,
      );
      setStatus(
        nextGuilds.length > 0
          ? `${nextGuilds.length} guild${nextGuilds.length === 1 ? "" : "s"} available.`
          : "Alshival is not in any Discord guilds yet.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load Discord guilds.");
      setGuilds([]);
      setSelectedGuildId(null);
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

  async function loadKnowledgeSources(guildId: string) {
    setIsKnowledgeLoading(true);
    setKnowledgeStatus("Loading knowledge sources...");

    try {
      const response = await fetch(`/api/platforms/discord/guilds/${guildId}/knowledge`);
      const data = (await response.json()) as {
        sources?: GuildKnowledgeSource[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load knowledge sources.");
      }

      setKnowledgeSources(data.sources ?? []);
      setKnowledgeStatus(
        data.sources?.length
          ? `${data.sources.length} knowledge source${data.sources.length === 1 ? "" : "s"} configured.`
          : "No knowledge sources configured for this guild yet.",
      );
    } catch (error) {
      setKnowledgeSources([]);
      setKnowledgeStatus(error instanceof Error ? error.message : "Could not load knowledge sources.");
    } finally {
      setIsKnowledgeLoading(false);
    }
  }

  async function loadGuildAgentConfig(guildId: string) {
    setGuildAgentStatus("Loading guild agent settings...");

    try {
      const response = await fetch(`/api/platforms/discord/guilds/${guildId}/agent`);
      const data = (await response.json()) as GuildAgentConfig | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not load guild agent settings.");
      }

      const nextConfig = data as GuildAgentConfig;
      setGuildAgentConfig(nextConfig);
      setGuildAgentProvider(nextConfig.provider);
      setGuildAgentModel(nextConfig.model);
      setGuildAgentInstructions(nextConfig.instructions);
      setGuildAgentStatus(
        nextConfig.inheritsDefault
          ? "This guild is using the default Agent settings."
          : "This guild has custom Agent settings.",
      );
    } catch (error) {
      setGuildAgentConfig(null);
      setGuildAgentStatus(error instanceof Error ? error.message : "Could not load guild agent settings.");
    }
  }

  async function saveGuildAgentConfig() {
    if (!selectedGuild) {
      return;
    }

    setIsGuildAgentSaving(true);
    setGuildAgentStatus("Saving guild agent settings...");

    try {
      const response = await fetch(`/api/platforms/discord/guilds/${selectedGuild.id}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: guildAgentProvider,
          model: guildAgentModel,
          instructions: guildAgentInstructions,
        }),
      });
      const data = (await response.json()) as GuildAgentConfig | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not save guild agent settings.");
      }

      const nextConfig = data as GuildAgentConfig;
      setGuildAgentConfig(nextConfig);
      setGuildAgentProvider(nextConfig.provider);
      setGuildAgentModel(nextConfig.model);
      setGuildAgentInstructions(nextConfig.instructions);
      setGuildAgentStatus("Guild agent settings saved.");
    } catch (error) {
      setGuildAgentStatus(error instanceof Error ? error.message : "Could not save guild agent settings.");
    } finally {
      setIsGuildAgentSaving(false);
    }
  }

  async function clearGuildAgentConfig() {
    if (!selectedGuild) {
      return;
    }

    setIsGuildAgentSaving(true);
    setGuildAgentStatus("Clearing guild agent override...");

    try {
      const response = await fetch(`/api/platforms/discord/guilds/${selectedGuild.id}/agent`, {
        method: "DELETE",
      });
      const data = (await response.json()) as GuildAgentConfig | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not clear guild agent settings.");
      }

      const nextConfig = data as GuildAgentConfig;
      setGuildAgentConfig(nextConfig);
      setGuildAgentProvider(nextConfig.provider);
      setGuildAgentModel(nextConfig.model);
      setGuildAgentInstructions(nextConfig.instructions);
      setGuildAgentStatus("Guild agent override cleared. This guild is using the default Agent settings.");
    } catch (error) {
      setGuildAgentStatus(error instanceof Error ? error.message : "Could not clear guild agent settings.");
    } finally {
      setIsGuildAgentSaving(false);
    }
  }

  async function clearGuildHistory() {
    if (!selectedGuild) {
      return;
    }

    const confirmed = window.confirm(
      `Clear all stored chat history for ${selectedGuild.name}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setIsHistoryClearing(true);
    setHistoryStatus("Clearing stored chat history...");

    try {
      const response = await fetch(`/api/platforms/discord/guilds/${selectedGuild.id}/history`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { deletedMessages?: number; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not clear chat history.");
      }

      const deletedMessages = data.deletedMessages ?? 0;
      setHistoryStatus(
        `Cleared ${deletedMessages} stored message${deletedMessages === 1 ? "" : "s"} for this guild.`,
      );
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : "Could not clear chat history.");
    } finally {
      setIsHistoryClearing(false);
    }
  }

  async function addKnowledgeSource() {
    if (!selectedGuild) {
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
      const response = await fetch(`/api/platforms/discord/guilds/${selectedGuild.id}/knowledge`, {
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
        sources?: GuildKnowledgeSource[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not add knowledge source.");
      }

      setKnowledgeSources(data.sources ?? []);
      setSelectedRepoFullName("");
      setRemoteOrigin("");
      setKnowledgeStatus("Knowledge source added. Indexing is running in the background.");
    } catch (error) {
      setKnowledgeStatus(error instanceof Error ? error.message : "Could not add knowledge source.");
    } finally {
      setIsKnowledgeLoading(false);
    }
  }

  async function removeKnowledgeSource(sourceId: number) {
    if (!selectedGuild) {
      return;
    }

    setIsKnowledgeLoading(true);
    setKnowledgeStatus("Removing knowledge source...");

    try {
      const response = await fetch(
        `/api/platforms/discord/guilds/${selectedGuild.id}/knowledge?sourceId=${sourceId}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as {
        sources?: GuildKnowledgeSource[];
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

  async function pullKnowledgeSource(sourceId: number) {
    if (!selectedGuild) {
      return;
    }

    setIsKnowledgeLoading(true);
    setKnowledgeStatus("Pulling knowledge source changes...");

    try {
      const response = await fetch(
        `/api/platforms/discord/guilds/${selectedGuild.id}/knowledge?sourceId=${sourceId}`,
        { method: "PATCH" },
      );
      const data = (await response.json()) as {
        sources?: GuildKnowledgeSource[];
        index?: { markdownFiles: number; chunks: number };
        sync?: { queued: boolean };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not pull knowledge source changes.");
      }

      setKnowledgeSources(data.sources ?? []);
      setKnowledgeStatus(
        data.index
          ? `Pulled changes and indexed ${data.index.markdownFiles} Markdown file${data.index.markdownFiles === 1 ? "" : "s"}.`
          : data.sync?.queued
            ? "Knowledge source changes pulled. Indexing is running in the background."
            : "Knowledge source changes pulled.",
      );
    } catch (error) {
      setKnowledgeStatus(error instanceof Error ? error.message : "Could not pull knowledge source changes.");
    } finally {
      setIsKnowledgeLoading(false);
    }
  }

  useEffect(() => {
    async function loadInitialGuilds() {
      await loadGuilds();
      await loadRepos();
    }

    void loadInitialGuilds();
  }, []);

  useEffect(() => {
    if (selectedGuild?.id) {
      void Promise.resolve().then(async () => {
        await Promise.all([
          loadGuildAgentConfig(selectedGuild.id),
          loadKnowledgeSources(selectedGuild.id),
        ]);
      });
    }
  }, [selectedGuild?.id]);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Discord</p>
          <h2>Guilds</h2>
        </div>
        <button className="secondary-action fit-content" disabled={isLoading} onClick={loadGuilds} type="button">
          <RefreshCw size={17} />
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="guild-admin-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Guild list</p>
              <h3>Servers</h3>
            </div>
            <Building2 size={20} />
          </div>
          <p className="status-copy guild-status">{status}</p>
          <div className="guild-list">
            {guilds.map((guild) => (
              <button
                className={`guild-row ${selectedGuild?.id === guild.id ? "active" : ""}`}
                key={guild.id}
                onClick={() => {
                  setSelectedGuildId(guild.id);
                  setHistoryStatus("Clear stored memory for this guild when needed.");
                }}
                type="button"
              >
                <GuildIcon guild={guild} />
                <span>
                  <strong>{guild.name}</strong>
                  <small>{guild.memberCount === null ? "Member count unavailable" : `${guild.memberCount} members`}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Selected guild</p>
              <h3>{selectedGuild ? selectedGuild.name : "No guild selected"}</h3>
            </div>
            <Server size={20} />
          </div>

          {selectedGuild ? (
            <div className="guild-detail">
              <GuildIcon guild={selectedGuild} large />
              <dl>
                <div>
                  <dt>Guild ID</dt>
                  <dd>{selectedGuild.id}</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{selectedGuild.memberCount ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Available</dt>
                  <dd>{selectedGuild.available ? "Yes" : "No"}</dd>
                </div>
              </dl>
              <section className="knowledge-section">
                <div className="panel-heading compact-heading">
                  <div>
                    <p className="eyebrow">Agent override</p>
                    <h3>Guild response settings</h3>
                  </div>
                  <Bot size={20} />
                </div>
                <div className="form-grid">
                  <label className="field">
                    <span>Provider</span>
                    <select
                      disabled={isGuildAgentSaving}
                      onChange={(event) => setGuildAgentProvider(event.target.value as Provider)}
                      value={guildAgentProvider}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Model ID</span>
                    <input
                      autoComplete="off"
                      disabled={isGuildAgentSaving}
                      onChange={(event) => setGuildAgentModel(event.target.value)}
                      placeholder={guildAgentProvider === "openai" ? "gpt-5.5" : "claude-sonnet-4-5"}
                      value={guildAgentModel}
                    />
                  </label>
                  <label className="field wide">
                    <span>Instructions</span>
                    <textarea
                      disabled={isGuildAgentSaving}
                      onChange={(event) => setGuildAgentInstructions(event.target.value)}
                      rows={5}
                      value={guildAgentInstructions}
                    />
                  </label>
                </div>
                {guildAgentProvider === "openai" ? (
                  <p className="status-copy">
                    OpenAI model IDs are listed in the{" "}
                    <a href="https://developers.openai.com/api/docs/models" rel="noreferrer" target="_blank">
                      OpenAI models documentation
                    </a>
                    . The model ID is validated when you save.
                  </p>
                ) : null}
                <div className="key-action-row">
                  <button
                    className="primary-action fit-content"
                    disabled={isGuildAgentSaving || guildAgentModel.trim().length === 0}
                    onClick={() => void saveGuildAgentConfig()}
                    type="button"
                  >
                    <Save size={17} />
                    {isGuildAgentSaving ? "Saving..." : "Save override"}
                  </button>
                  <button
                    className="secondary-action fit-content"
                    disabled={isGuildAgentSaving || guildAgentConfig?.inheritsDefault === true}
                    onClick={() => void clearGuildAgentConfig()}
                    type="button"
                  >
                    <RotateCcw size={17} />
                    Use default
                  </button>
                </div>
                <p className="status-copy">{guildAgentStatus}</p>
              </section>
              <section className="knowledge-section">
                <div className="panel-heading compact-heading">
                  <div>
                    <p className="eyebrow">Chat memory</p>
                    <h3>Stored history</h3>
                  </div>
                  <Trash2 size={20} />
                </div>
                <p className="placeholder-copy">
                  Clear the stored Discord message history that Alshival uses as memory for this guild.
                </p>
                <div className="key-action-row">
                  <button
                    className="secondary-action fit-content"
                    disabled={isHistoryClearing}
                    onClick={() => void clearGuildHistory()}
                    type="button"
                  >
                    <Trash2 size={17} />
                    {isHistoryClearing ? "Clearing..." : "Clear chat history"}
                  </button>
                </div>
                <p className="status-copy">{historyStatus}</p>
              </section>
              <section className="knowledge-section">
                <div className="panel-heading compact-heading">
                  <div>
                    <p className="eyebrow">Knowledge</p>
                    <h3>Guild knowledge sources</h3>
                  </div>
                  <BookOpen size={20} />
                </div>
                <div className="knowledge-add-row">
                  <label className="field">
                    <span>Source</span>
                    <select
                      disabled={isKnowledgeLoading}
                      onChange={(event) => setKnowledgeSourceMode(event.target.value as "select" | "remote")}
                      value={knowledgeSourceMode}
                    >
                      <option value="select">Select a repository</option>
                      <option value="remote">Add remote origin</option>
                    </select>
                  </label>
                  {knowledgeSourceMode === "select" ? (
                    <label className="field">
                      <span>GitHub repository</span>
                      <select
                        disabled={isKnowledgeLoading || repos.length === 0}
                        onChange={(event) => setSelectedRepoFullName(event.target.value)}
                        value={selectedRepoFullName}
                      >
                        <option value="">Select a repository</option>
                        {repos.map((repo) => (
                          <option key={repo.id} value={repo.fullName}>
                            {repo.fullName} · {repo.accessOrg}
                            {repo.private ? " (private)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="field">
                      <span>Remote origin</span>
                      <input
                        disabled={isKnowledgeLoading}
                        onChange={(event) => setRemoteOrigin(event.target.value)}
                        placeholder="https://github.com/org/repo.git"
                        value={remoteOrigin}
                      />
                    </label>
                  )}
                  <button
                    className="primary-action fit-content"
                    disabled={
                      isKnowledgeLoading ||
                      (knowledgeSourceMode === "select"
                        ? selectedRepoFullName.length === 0
                        : remoteOrigin.trim().length === 0)
                    }
                    onClick={() => void addKnowledgeSource()}
                    type="button"
                  >
                    <Plus size={17} />
                    Add source
                  </button>
                </div>
                <p className="status-copy">
                  {knowledgeSourceMode === "remote"
                    ? "Remote origins are normalized to SSH and cloned with the configured GitHub SSH key."
                    : knowledgeStatus}
                </p>
                {knowledgeSourceMode === "remote" ? <p className="status-copy">{knowledgeStatus}</p> : null}
                <div className="knowledge-source-list">
                  {knowledgeSources.map((source) => (
                    <div className="knowledge-source-row" key={source.id}>
                      <span>
                        <strong>{source.repoFullName}</strong>
                        <small>
                          {source.indexedAt
                            ? `Indexed ${source.indexedMarkdownFiles} Markdown file${source.indexedMarkdownFiles === 1 ? "" : "s"}`
                            : "Not indexed yet"}
                        </small>
                      </span>
                      <div className="button-row">
                        <button
                          className="secondary-action fit-content"
                          disabled={isKnowledgeLoading}
                          onClick={() => void pullKnowledgeSource(source.id)}
                          type="button"
                        >
                          <RefreshCw size={16} />
                          Pull Changes
                        </button>
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
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="empty-state">
              <p>Select a Discord guild to manage its agent settings, memory, and knowledge sources.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function GuildIcon({ guild, large = false }: { guild: DiscordGuildSummary; large?: boolean }) {
  const className = large ? "guild-icon large" : "guild-icon";

  if (guild.iconUrl) {
    return <Image alt="" className={className} height={large ? 64 : 40} src={guild.iconUrl} width={large ? 64 : 40} />;
  }

  return <span className={className}>{guild.name.slice(0, 1).toUpperCase()}</span>;
}
