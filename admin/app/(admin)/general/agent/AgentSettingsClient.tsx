"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, Save, SendHorizontal } from "lucide-react";

type Provider = "openai" | "anthropic";

type AgentConfig = {
  provider: Provider;
  model: string;
  instructions: string;
  updatedAt: string | null;
};

type AgentResponse = {
  provider: string;
  model: string;
  text: string;
};

const defaultConfig: AgentConfig = {
  provider: "openai",
  model: "gpt-5.5",
  instructions: "You are Alshival, a helpful AI agent.",
  updatedAt: null,
};

export default function AgentSettingsClient() {
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("gpt-5.5");
  const [instructions, setInstructions] = useState(defaultConfig.instructions);
  const [status, setStatus] = useState("Loading agent settings...");
  const [isSaving, setIsSaving] = useState(false);
  const [testInput, setTestInput] = useState("Say hello as Alshival.");
  const [testResponse, setTestResponse] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  async function loadConfig() {
    const response = await fetch("/api/settings/agent");
    const data = (await response.json()) as AgentConfig;

    if (!response.ok) {
      throw new Error("Could not load agent settings.");
    }

    setConfig(data);
    setProvider(data.provider);
    setModel(data.model);
    setInstructions(data.instructions);
    setStatus(data.updatedAt ? "Agent settings saved." : "Using default agent settings.");
  }

  useEffect(() => {
    void Promise.resolve()
      .then(loadConfig)
      .catch(() => setStatus("Could not load agent settings."));
  }, []);

  function updateProvider(nextProvider: Provider) {
    setProvider(nextProvider);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus("Saving agent settings...");

    try {
      const response = await fetch("/api/settings/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, instructions }),
      });
      const data = (await response.json()) as AgentConfig | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && typeof data.error === "string" ? data.error : "Could not save agent settings.");
      }

      const nextConfig = data as AgentConfig;
      setConfig(nextConfig);
      setProvider(nextConfig.provider);
      setModel(nextConfig.model);
      setInstructions(nextConfig.instructions);
      setStatus("Agent settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save agent settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function testAgent() {
    setIsTesting(true);
    setTestResponse("");

    try {
      const response = await fetch("/api/agent/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: testInput }),
      });
      const data = (await response.json()) as AgentResponse | { error?: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data && data.error ? data.error : "Could not generate response.");
      }

      setTestResponse((data as AgentResponse).text);
    } catch (error) {
      setTestResponse(error instanceof Error ? error.message : "Could not generate response.");
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">General</p>
          <h2>Agent</h2>
        </div>
      </header>

      <div className="agent-grid">
        <section className="panel">
          <div className="panel-heading">
            <div className="heading-with-icon">
              <Bot size={34} />
              <div>
                <p className="eyebrow">Runtime</p>
                <h3>Default Response Settings</h3>
              </div>
            </div>
          </div>

          <form className="language-model-form" onSubmit={saveSettings}>
            <div className="form-grid">
              <label className="field">
                <span>Provider</span>
                <select onChange={(event) => updateProvider(event.target.value as Provider)} value={provider}>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>

              <label className="field">
                <span>Model ID</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={provider === "openai" ? "gpt-5.5" : "claude-sonnet-4-5"}
                  value={model}
                />
              </label>

              <label className="field wide">
                <span>Instructions</span>
                <textarea
                  onChange={(event) => setInstructions(event.target.value)}
                  rows={7}
                  value={instructions}
                />
              </label>
            </div>
            {provider === "openai" ? (
              <p className="status-copy">
                OpenAI model IDs are listed in the{" "}
                <a href="https://developers.openai.com/api/docs/models" rel="noreferrer" target="_blank">
                  OpenAI models documentation
                </a>
                . The model ID is validated against your saved OpenAI API key when you save.
              </p>
            ) : null}

            <div className="key-action-row">
              <button className="primary-action fit-content" disabled={isSaving} type="submit">
                <Save size={17} />
                {isSaving ? "Saving..." : "Save agent"}
              </button>
            </div>
            <p className="status-copy">
              {status}
              {config.updatedAt ? ` Last updated ${new Date(config.updatedAt).toLocaleString()}.` : ""}
            </p>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Test</p>
              <h3>Generate Response</h3>
            </div>
            <SendHorizontal size={20} />
          </div>

          <div className="language-model-form">
            <label className="field">
              <span>Input</span>
              <textarea
                onChange={(event) => setTestInput(event.target.value)}
                rows={5}
                value={testInput}
              />
            </label>
            <button
              className="primary-action fit-content"
              disabled={isTesting || testInput.trim().length === 0}
              onClick={testAgent}
              type="button"
            >
              <SendHorizontal size={17} />
              {isTesting ? "Generating..." : "Test agent"}
            </button>
            {testResponse ? <div className="agent-response">{testResponse}</div> : null}
          </div>
        </section>
      </div>
    </>
  );
}
