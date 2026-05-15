"use client";

import { FormEvent, useEffect, useState } from "react";
import { BrainCircuit, KeyRound, Save, Trash2 } from "lucide-react";

type LanguageModelProvider = "openai" | "anthropic";

type LanguageModelSettings = {
  provider: LanguageModelProvider;
  hasOpenAiApiKey: boolean;
  openAiApiKeyLast4: string | null;
  hasAnthropicApiKey: boolean;
  anthropicApiKeyLast4: string | null;
  updatedAt: string | null;
};

const emptySettings: LanguageModelSettings = {
  provider: "openai",
  hasOpenAiApiKey: false,
  openAiApiKeyLast4: null,
  hasAnthropicApiKey: false,
  anthropicApiKeyLast4: null,
  updatedAt: null,
};

export default function LanguageModelsClient() {
  const [settings, setSettings] = useState<LanguageModelSettings>(emptySettings);
  const [provider, setProvider] = useState<LanguageModelProvider>("openai");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [status, setStatus] = useState("Loading language model settings...");
  const [isSaving, setIsSaving] = useState(false);

  async function loadSettings() {
    const response = await fetch("/api/settings/language-models");
    const data = (await response.json()) as LanguageModelSettings;

    if (!response.ok) {
      throw new Error("Could not load language model settings.");
    }

    setSettings(data);
    setProvider(data.provider);
    setStatus(
      data.hasOpenAiApiKey || data.hasAnthropicApiKey
        ? "Language model credentials saved."
        : "No language model credentials saved yet.",
    );
  }

  useEffect(() => {
    void Promise.resolve()
      .then(loadSettings)
      .catch(() => setStatus("Could not load language model settings."));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus("Saving language model settings...");

    try {
      const response = await fetch("/api/settings/language-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, openAiApiKey, anthropicApiKey }),
      });
      const data = (await response.json()) as LanguageModelSettings;

      if (!response.ok) {
        throw new Error("Could not save language model settings.");
      }

      setSettings(data);
      setProvider(data.provider);
      setOpenAiApiKey("");
      setAnthropicApiKey("");
      setStatus("Language model settings saved.");
    } catch {
      setStatus("Could not save language model settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function clearSettings() {
    setIsSaving(true);
    setStatus("Clearing language model settings...");

    try {
      const response = await fetch("/api/settings/language-models", { method: "DELETE" });
      const data = (await response.json()) as LanguageModelSettings;

      if (!response.ok) {
        throw new Error("Could not clear language model settings.");
      }

      setSettings(data);
      setProvider(data.provider);
      setOpenAiApiKey("");
      setAnthropicApiKey("");
      setStatus("Language model settings cleared.");
    } catch {
      setStatus("Could not clear language model settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Agent</p>
          <h2>Language Models</h2>
        </div>
      </header>

      <section className="panel language-model-panel">
        <div className="panel-heading">
          <div className="heading-with-icon">
            <BrainCircuit size={34} />
            <div>
              <p className="eyebrow">Provider</p>
              <h3>Model Credentials</h3>
            </div>
          </div>
          <KeyRound size={20} />
        </div>

        <form className="language-model-form" onSubmit={handleSubmit}>
          <div className="provider-options" role="radiogroup" aria-label="Language model provider">
            <label className={`provider-option ${provider === "openai" ? "active" : ""}`}>
              <input
                checked={provider === "openai"}
                name="provider"
                onChange={() => setProvider("openai")}
                type="radio"
                value="openai"
              />
              <span>
                <strong>OpenAI</strong>
                <small>
                  {settings.hasOpenAiApiKey
                    ? `API key saved ending in ${settings.openAiApiKeyLast4}`
                    : "No API key saved"}
                </small>
              </span>
            </label>

            <label className={`provider-option ${provider === "anthropic" ? "active" : ""}`}>
              <input
                checked={provider === "anthropic"}
                name="provider"
                onChange={() => setProvider("anthropic")}
                type="radio"
                value="anthropic"
              />
              <span>
                <strong>Anthropic</strong>
                <small>
                  {settings.hasAnthropicApiKey
                    ? `API key saved ending in ${settings.anthropicApiKeyLast4}`
                    : "No API key saved"}
                </small>
              </span>
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>OpenAI API key</span>
              <input
                autoComplete="off"
                onChange={(event) => setOpenAiApiKey(event.target.value)}
                placeholder={
                  settings.hasOpenAiApiKey
                    ? `Saved key ending in ${settings.openAiApiKeyLast4}`
                    : "sk-..."
                }
                type="password"
                value={openAiApiKey}
              />
            </label>

            <label className="field">
              <span>Anthropic API key</span>
              <input
                autoComplete="off"
                onChange={(event) => setAnthropicApiKey(event.target.value)}
                placeholder={
                  settings.hasAnthropicApiKey
                    ? `Saved key ending in ${settings.anthropicApiKeyLast4}`
                    : "sk-ant-..."
                }
                type="password"
                value={anthropicApiKey}
              />
            </label>
          </div>

          <div className="key-action-row">
            <button className="primary-action fit-content" disabled={isSaving} type="submit">
              <Save size={17} />
              {isSaving ? "Saving..." : "Save credentials"}
            </button>
            <button className="secondary-action fit-content" disabled={isSaving} onClick={clearSettings} type="button">
              <Trash2 size={17} />
              Clear
            </button>
          </div>
          <p className="status-copy">{status}</p>
        </form>
      </section>
    </>
  );
}
