"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListChecks, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

type AsanaBoardScope = {
  boardId: string;
  boardName: string | null;
  workspaceName: string | null;
};

type AsanaChannelScope = {
  id: number;
  channelId: string;
  channelName: string | null;
  mode: "all" | "specific";
  boards: AsanaBoardScope[];
  updatedAt: string;
};

type ApiResponse = {
  scopes?: AsanaChannelScope[];
  error?: string;
};

export type AsanaChannelOption = {
  id: string;
  name: string;
  description?: string | null;
};

export default function AsanaChannelScopes({
  endpoint,
  channelOptions = [],
  disabled,
}: {
  endpoint: string | null;
  channelOptions?: AsanaChannelOption[];
  disabled?: boolean;
}) {
  const [scopes, setScopes] = useState<AsanaChannelScope[]>([]);
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [mode, setMode] = useState<"all" | "specific">("all");
  const [boardLines, setBoardLines] = useState("");
  const [boards, setBoards] = useState<AsanaBoardScope[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [status, setStatus] = useState("Select a channel scope to configure Asana access.");
  const [boardStatus, setBoardStatus] = useState("Connect Asana to load boards.");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);

  const parsedBoards = useMemo(
    () =>
      boardLines
        .split("\n")
        .map((line) => {
          const [boardId, boardName, workspaceName] = line.split("|").map((part) => part.trim());

          if (!boardId) {
            return null;
          }

          return {
            boardId,
            boardName: boardName || null,
            workspaceName: workspaceName || null,
          };
        })
        .filter((board): board is AsanaBoardScope => board !== null),
    [boardLines],
  );

  const loadScopes = useCallback(async () => {
    if (!endpoint) {
      setScopes([]);
      setStatus("Select a Discord guild or Slack workspace first.");
      return;
    }

    const response = await fetch(endpoint);
    const data = (await response.json()) as ApiResponse;

    if (!response.ok) {
      throw new Error(data.error ?? "Could not load Asana channel scopes.");
    }

    setScopes(data.scopes ?? []);
    setStatus(
      data.scopes?.length
        ? `${data.scopes.length} Asana channel scope${data.scopes.length === 1 ? "" : "s"} configured.`
        : "No Asana channel scopes configured yet.",
    );
  }, [endpoint]);

  const loadBoards = useCallback(async () => {
    setIsLoadingBoards(true);

    try {
      const response = await fetch("/api/settings/asana-mcp/boards");
      const data = (await response.json()) as { boards?: AsanaBoardScope[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load Asana boards.");
      }

      setBoards(data.boards ?? []);
      setBoardStatus(
        data.boards?.length
          ? `${data.boards.length} Asana board${data.boards.length === 1 ? "" : "s"} available.`
          : "No Asana boards available to the connected account.",
      );
    } finally {
      setIsLoadingBoards(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve()
      .then(loadScopes)
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : "Could not load Asana channel scopes.");
      });
  }, [loadScopes]);

  useEffect(() => {
    void Promise.resolve()
      .then(loadBoards)
      .catch((error) => {
        setBoards([]);
        setBoardStatus(error instanceof Error ? error.message : "Could not load Asana boards.");
      });
  }, [loadBoards]);

  function addSelectedBoard() {
    const board = boards.find((candidate) => candidate.boardId === selectedBoardId);

    if (!board) {
      return;
    }

    const line = [board.boardId, board.boardName ?? "", board.workspaceName ?? ""]
      .join(" | ")
      .replace(/\s+\|\s+$/g, "");

    if (parsedBoards.some((candidate) => candidate.boardId === board.boardId)) {
      return;
    }

    setBoardLines((current) => (current.trim() ? `${current.trim()}\n${line}` : line));
    setSelectedBoardId("");
  }

  function selectChannel(nextChannelId: string) {
    setChannelId(nextChannelId);
    const option = channelOptions.find((candidate) => candidate.id === nextChannelId);

    if (option) {
      setChannelName(option.name);
    }
  }

  async function saveScope() {
    if (!endpoint) {
      return;
    }

    setIsSaving(true);
    setStatus("Saving Asana channel scope...");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          channelName,
          mode,
          boards: parsedBoards,
        }),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Could not save Asana channel scope.");
      }

      setScopes(data.scopes ?? []);
      setChannelId("");
      setChannelName("");
      setBoardLines("");
      setMode("all");
      setStatus("Asana channel scope saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save Asana channel scope.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteScope(scope: AsanaChannelScope) {
    if (!endpoint) {
      return;
    }

    setIsSaving(true);
    setStatus("Removing Asana channel scope...");

    try {
      const response = await fetch(`${endpoint}?channelId=${encodeURIComponent(scope.channelId)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Could not remove Asana channel scope.");
      }

      setScopes(data.scopes ?? []);
      setStatus("Asana channel scope removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove Asana channel scope.");
    } finally {
      setIsSaving(false);
    }
  }

  function editScope(scope: AsanaChannelScope) {
    setChannelId(scope.channelId);
    setChannelName(scope.channelName ?? "");
    setMode(scope.mode);
    setBoardLines(
      scope.boards
        .map((board) =>
          [board.boardId, board.boardName ?? "", board.workspaceName ?? ""]
            .join(" | ")
            .replace(/\s+\|\s+$/g, ""),
        )
        .join("\n"),
    );
  }

  return (
    <div className="connection-card">
      <div>
        <p className="eyebrow">Asana</p>
        <h4>Channel board access</h4>
      </div>

      <div className="button-row">
        <button
          className="secondary-action fit-content compact-action"
          disabled={disabled || isLoadingBoards}
          onClick={() => void loadBoards().catch((error) => {
            setBoards([]);
            setBoardStatus(error instanceof Error ? error.message : "Could not load Asana boards.");
          })}
          type="button"
        >
          <RefreshCw size={15} />
          Refresh boards
        </button>
        <p className="status-copy">{isLoadingBoards ? "Loading Asana boards..." : boardStatus}</p>
      </div>

      <div className="form-grid">
        {channelOptions.length > 0 ? (
          <label className="field wide">
            <span>Channel</span>
            <select
              disabled={disabled || isSaving}
              onChange={(event) => selectChannel(event.target.value)}
              value={channelId}
            >
              <option value="">Select a channel</option>
              {channelOptions.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                  {channel.description ? ` · ${channel.description}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>Channel ID</span>
            <input
              autoComplete="off"
              disabled={disabled || isSaving}
              onChange={(event) => setChannelId(event.target.value)}
              placeholder="Discord or Slack channel ID"
              value={channelId}
            />
          </label>
        )}
        {channelOptions.length > 0 ? (
          <label className="field">
            <span>Channel ID</span>
            <input
              autoComplete="off"
              disabled={disabled || isSaving}
              onChange={(event) => setChannelId(event.target.value)}
              placeholder="Manual channel ID"
              value={channelId}
            />
          </label>
        ) : null}
        <label className="field">
          <span>Channel label</span>
          <input
            autoComplete="off"
            disabled={disabled || isSaving}
            onChange={(event) => setChannelName(event.target.value)}
            placeholder="Optional display name"
            value={channelName}
          />
        </label>
        <label className="field wide">
          <span>Asana access</span>
          <select disabled={disabled || isSaving} onChange={(event) => setMode(event.target.value as "all" | "specific")} value={mode}>
            <option value="all">All boards available to this channel</option>
            <option value="specific">Only specific boards</option>
          </select>
        </label>
        {mode === "specific" ? (
          <>
            <label className="field wide">
              <span>Add board</span>
              <select
                disabled={disabled || isSaving || boards.length === 0}
                onChange={(event) => setSelectedBoardId(event.target.value)}
                value={selectedBoardId}
              >
                <option value="">Select an Asana board</option>
                {boards.map((board) => (
                  <option key={board.boardId} value={board.boardId}>
                    {board.workspaceName ? `${board.workspaceName} · ` : ""}
                    {board.boardName ?? board.boardId}
                  </option>
                ))}
              </select>
            </label>
            <div className="field wide">
              <button
                className="secondary-action fit-content compact-action"
                disabled={disabled || isSaving || !selectedBoardId}
                onClick={addSelectedBoard}
                type="button"
              >
                <Plus size={15} />
                Add selected board
              </button>
            </div>
            <label className="field wide">
              <span>Allowed boards</span>
              <textarea
                disabled={disabled || isSaving}
                onChange={(event) => setBoardLines(event.target.value)}
                placeholder="board-id | Board name | Workspace name"
                rows={5}
                value={boardLines}
              />
            </label>
          </>
        ) : null}
      </div>

      <button
        className="primary-action fit-content"
        disabled={disabled || isSaving || !channelId.trim() || (mode === "specific" && parsedBoards.length === 0)}
        onClick={() => void saveScope()}
        type="button"
      >
        <Save size={17} />
        Save Asana scope
      </button>
      <p className="status-copy">{status}</p>

      <div className="knowledge-source-list">
        {scopes.map((scope) => (
          <div className="knowledge-source-row" key={scope.id}>
            <span>
              <strong>{scope.channelName || scope.channelId}</strong>
              <small>
                {scope.mode === "all"
                  ? "All Asana boards"
                  : `${scope.boards.length} allowed board${scope.boards.length === 1 ? "" : "s"}`}
              </small>
            </span>
            <div className="button-row">
              <button
                className="secondary-action fit-content compact-action"
                disabled={disabled || isSaving}
                onClick={() => editScope(scope)}
                type="button"
              >
                <Plus size={15} />
                Edit
              </button>
              <button
                className="secondary-action fit-content compact-action"
                disabled={disabled || isSaving}
                onClick={() => void deleteScope(scope)}
                type="button"
              >
                <Trash2 size={15} />
                Remove
              </button>
            </div>
          </div>
        ))}
        {scopes.length === 0 ? (
          <div className="empty-state compact-empty">
            <ListChecks size={20} />
            <p>No channel scopes configured.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
