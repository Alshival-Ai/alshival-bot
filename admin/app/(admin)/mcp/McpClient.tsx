"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bell, BookOpen, ImageIcon, Save, Trash2, Wrench } from "lucide-react";

type McpSettings = {
  gifSearch: {
    enabled: boolean;
    hasKlipyApiKey: boolean;
    klipyApiKeyLast4: string | null;
    queryPrefix: string;
    defaultLimit: number;
    updatedAt: string | null;
  };
};

const emptySettings: McpSettings = {
  gifSearch: {
    enabled: false,
    hasKlipyApiKey: false,
    klipyApiKeyLast4: null,
    queryPrefix: "",
    defaultLimit: 8,
    updatedAt: null,
  },
};

export default function McpClient() {
  const [settings, setSettings] = useState<McpSettings>(emptySettings);
  const [selectedTool, setSelectedTool] = useState("search_gif");
  const [enabled, setEnabled] = useState(false);
  const [klipyApiKey, setKlipyApiKey] = useState("");
  const [queryPrefix, setQueryPrefix] = useState("");
  const [defaultLimit, setDefaultLimit] = useState(8);
  const [status, setStatus] = useState("Loading MCP tools...");
  const [isSaving, setIsSaving] = useState(false);

  async function loadSettings() {
    const response = await fetch("/api/settings/mcp/tools");
    const data = (await response.json()) as McpSettings;

    if (!response.ok) {
      throw new Error("Could not load MCP tools.");
    }

    setSettings(data);
    setEnabled(data.gifSearch.enabled);
    setQueryPrefix(data.gifSearch.queryPrefix);
    setDefaultLimit(data.gifSearch.defaultLimit);
    setStatus(data.gifSearch.enabled ? "GIF Search is enabled." : "GIF Search is disabled.");
  }

  useEffect(() => {
    void Promise.resolve()
      .then(loadSettings)
      .catch(() => setStatus("Could not load MCP tools."));
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus("Saving MCP tool settings...");

    try {
      const response = await fetch("/api/settings/mcp/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gifSearch: {
            enabled,
            klipyApiKey,
            queryPrefix,
            defaultLimit,
          },
        }),
      });
      const data = (await response.json()) as McpSettings | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not save MCP tools.");
      }

      const nextSettings = data as McpSettings;
      setSettings(nextSettings);
      setEnabled(nextSettings.gifSearch.enabled);
      setQueryPrefix(nextSettings.gifSearch.queryPrefix);
      setDefaultLimit(nextSettings.gifSearch.defaultLimit);
      setKlipyApiKey("");
      setStatus("MCP tool settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save MCP tools.");
    } finally {
      setIsSaving(false);
    }
  }

  async function clearSettings() {
    setIsSaving(true);
    setStatus("Clearing MCP tool settings...");

    try {
      const response = await fetch("/api/settings/mcp/tools", { method: "DELETE" });
      const data = (await response.json()) as McpSettings | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not clear MCP tools.");
      }

      const nextSettings = data as McpSettings;
      setSettings(nextSettings);
      setEnabled(nextSettings.gifSearch.enabled);
      setQueryPrefix(nextSettings.gifSearch.queryPrefix);
      setDefaultLimit(nextSettings.gifSearch.defaultLimit);
      setKlipyApiKey("");
      setStatus("MCP tool settings cleared.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear MCP tools.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Agent tools</p>
          <h2>MCP</h2>
        </div>
      </header>

      <div className="mcp-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Tool list</p>
              <h3>Tools</h3>
            </div>
            <Wrench size={20} />
          </div>

          <div className="guild-list">
            <button
              className={`guild-row ${selectedTool === "search_gif" ? "active" : ""}`}
              onClick={() => setSelectedTool("search_gif")}
              type="button"
            >
              <span className="guild-icon">
                <ImageIcon size={19} />
              </span>
              <span>
                <strong>GIF Search</strong>
                <small>{settings.gifSearch.enabled ? "Enabled" : "Disabled"}</small>
              </span>
            </button>
            <button
              className={`guild-row ${selectedTool === "discord_guild_kb" ? "active" : ""}`}
              onClick={() => setSelectedTool("discord_guild_kb")}
              type="button"
            >
              <span className="guild-icon">
                <BookOpen size={19} />
              </span>
              <span>
                <strong>Discord Guild KB</strong>
                <small>Enabled for Discord guilds with indexed knowledge</small>
              </span>
            </button>
            <button
              className={`guild-row ${selectedTool === "discord_guild_code" ? "active" : ""}`}
              onClick={() => setSelectedTool("discord_guild_code")}
              type="button"
            >
              <span className="guild-icon">
                <BookOpen size={19} />
              </span>
              <span>
                <strong>Discord Guild Code</strong>
                <small>Enabled for Discord guilds with cloned repos</small>
              </span>
            </button>
            <button
              className={`guild-row ${selectedTool === "reminders" ? "active" : ""}`}
              onClick={() => setSelectedTool("reminders")}
              type="button"
            >
              <span className="guild-icon">
                <Bell size={19} />
              </span>
              <span>
                <strong>Reminders</strong>
                <small>Set, edit, and delete scheduled reminders</small>
              </span>
            </button>
          </div>
        </section>

        <section className="panel">
          {selectedTool === "discord_guild_kb" || selectedTool === "discord_guild_code" || selectedTool === "reminders" ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">
                    {selectedTool === "discord_guild_kb"
                      ? "Discord Guild KB"
                      : selectedTool === "discord_guild_code"
                        ? "Discord Guild Code"
                        : "Reminders"}
                  </p>
                  <h3>
                    {selectedTool === "discord_guild_kb"
                      ? "Knowledge Search"
                      : selectedTool === "discord_guild_code"
                        ? "Code Search"
                        : "Scheduled Reminders"}
                  </h3>
                </div>
                {selectedTool === "reminders" ? <Bell size={20} /> : <BookOpen size={20} />}
              </div>
              <p className="placeholder-copy">
                {selectedTool === "discord_guild_kb"
                  ? "This tool is available automatically when Alshival is responding inside a Discord guild. It searches the guild's indexed ChromaDB collection from configured knowledge sources."
                  : selectedTool === "discord_guild_code"
                    ? "This tool is available automatically when Alshival is responding inside a Discord guild with cloned GitHub knowledge sources. It searches the local repo clones for exact implementation details."
                    : "These tools are available in platform conversations. Discord reminders are sent back to the same guild and channel where they were created."}
              </p>
            </>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">GIF Search</p>
                  <h3>KLIPY Configuration</h3>
                </div>
                <ImageIcon size={20} />
              </div>

              <form className="language-model-form" onSubmit={saveSettings}>
                <label className="toggle-row">
                  <input
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Enable GIF Search tool</span>
                </label>

                <div className="form-grid">
                  <label className="field wide">
                    <span>KLIPY API key</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setKlipyApiKey(event.target.value)}
                      placeholder={
                        settings.gifSearch.hasKlipyApiKey
                          ? `Saved key ending in ${settings.gifSearch.klipyApiKeyLast4}`
                          : "KLIPY API key"
                      }
                      type="password"
                      value={klipyApiKey}
                    />
                  </label>
                  <label className="field">
                    <span>Query prefix</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setQueryPrefix(event.target.value)}
                      placeholder="Optional, e.g. anime"
                      value={queryPrefix}
                    />
                  </label>
                  <label className="field">
                    <span>Default result limit</span>
                    <input
                      max={20}
                      min={1}
                      onChange={(event) => setDefaultLimit(Number(event.target.value))}
                      type="number"
                      value={defaultLimit}
                    />
                  </label>
                </div>

                <div className="key-action-row">
                  <button className="primary-action fit-content" disabled={isSaving} type="submit">
                    <Save size={17} />
                    {isSaving ? "Saving..." : "Save tool"}
                  </button>
                  <button className="secondary-action fit-content" disabled={isSaving} onClick={clearSettings} type="button">
                    <Trash2 size={17} />
                    Clear
                  </button>
                </div>
                <p className="status-copy">{status}</p>
              </form>
            </>
          )}
        </section>
      </div>
    </>
  );
}
