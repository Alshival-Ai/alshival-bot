import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import type { AsanaChannelScope } from "./db.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "alshival-asana-test-"));
process.env.BOT_DB_PATH = path.join(root, "bot.db");

const db = await import("./db.js");
const asana = await import("./asana.js");

await db.saveAsanaOAuthTokens({
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 3600,
});
const settingsDb = new Database(process.env.BOT_DB_PATH);
const settingsRow = settingsDb
  .prepare("SELECT value FROM agent_settings WHERE key = ?")
  .get("asana_mcp_settings") as { value: string };
const settings = JSON.parse(settingsRow.value) as Record<string, unknown>;
settings.clientId = "client-id";
settings.clientSecret = "client-secret";
settingsDb
  .prepare("UPDATE agent_settings SET value = ?, updated_at = ? WHERE key = ?")
  .run(JSON.stringify(settings), new Date().toISOString(), "asana_mcp_settings");
settingsDb.close();

const scope: AsanaChannelScope = {
  id: 1,
  platform: "discord",
  contextId: "guild",
  channelId: "channel",
  channelName: null,
  mode: "specific",
  boards: [{ boardId: "board-1", boardName: "Board 1", workspaceName: "Workspace" }],
  createdAt: "",
  updatedAt: "",
};

type FetchCall = {
  url: string;
  method: string;
  body: unknown;
};

function task(gid: string, boardId = "board-1") {
  return {
    gid,
    name: `Task ${gid}`,
    completed: false,
    memberships: [
      {
        project: { gid: boardId, name: boardId },
        section: { gid: "section-1", name: "Section 1" },
      },
    ],
  };
}

function installFetch(handler: (call: FetchCall) => { status?: number; body: unknown }) {
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const call = {
      url,
      method: init?.method ?? "GET",
      body,
    };
    calls.push(call);
    const result = handler(call);

    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("createAsanaTask rejects boards outside a specific channel scope before fetching", async () => {
  const calls = installFetch(() => ({ body: { data: [] } }));

  await assert.rejects(
    asana.createAsanaTask({
      scope,
      boardId: "board-2",
      name: "Unauthorized",
    }),
    /not authorized/,
  );
  assert.equal(calls.length, 0);
});

test("createAsanaTask validates section, creates task, and adds it to the section", async () => {
  const calls = installFetch((call) => {
    if (call.url.includes("/projects/board-1/sections")) {
      return { body: { data: [{ gid: "section-1", name: "Doing" }] } };
    }
    if (call.url.endsWith("/tasks?opt_fields=gid%2Cname%2Cnotes%2Ccompleted%2Cdue_on%2Cdue_at%2Cmodified_at%2Cpermalink_url%2Cassignee.gid%2Cassignee.name%2Cassignee.email%2Cmemberships.project.gid%2Cmemberships.project.name%2Cmemberships.section.gid%2Cmemberships.section.name")) {
      return { body: { data: task("task-1") } };
    }
    if (call.url.includes("/sections/section-1/addTask")) {
      return { body: { data: {} } };
    }
    if (call.url.includes("/tasks/task-1?")) {
      return { body: { data: task("task-1") } };
    }

    throw new Error(`Unexpected Asana request: ${call.method} ${call.url}`);
  });

  const result = await asana.createAsanaTask({
    scope,
    boardId: "board-1",
    name: "New task",
    notes: "Details",
    dueOn: "2026-07-15",
    assigneeGid: "user-1",
    sectionId: "section-1",
  });

  assert.equal(result.task.gid, "task-1");
  const createCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/tasks?opt_fields=gid%2Cname%2Cnotes%2Ccompleted%2Cdue_on%2Cdue_at%2Cmodified_at%2Cpermalink_url%2Cassignee.gid%2Cassignee.name%2Cassignee.email%2Cmemberships.project.gid%2Cmemberships.project.name%2Cmemberships.section.gid%2Cmemberships.section.name"));
  const sectionCall = calls.find((call) => call.method === "POST" && call.url.includes("/sections/section-1/addTask"));

  assert.ok(createCall);
  assert.deepEqual(createCall.body, {
    data: {
      name: "New task",
      projects: ["board-1"],
      notes: "Details",
      due_on: "2026-07-15",
      assignee: "user-1",
    },
  });
  assert.ok(sectionCall);
  assert.deepEqual(sectionCall.body, { data: { task: "task-1" } });
});

test("updateAsanaTask rejects a task that is not in the authorized board before PUT", async () => {
  const calls = installFetch((call) => {
    if (call.url.includes("/tasks/task-2?")) {
      return { body: { data: task("task-2", "board-2") } };
    }

    throw new Error(`Unexpected Asana request: ${call.method} ${call.url}`);
  });

  await assert.rejects(
    asana.updateAsanaTask({
      scope,
      boardId: "board-1",
      taskGid: "task-2",
      completed: true,
    }),
    /not in authorized board/,
  );
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("addAsanaDependency requires both tasks to belong to the authorized board", async () => {
  const calls = installFetch((call) => {
    if (call.url.includes("/tasks/task-1?")) {
      return { body: { data: task("task-1", "board-1") } };
    }
    if (call.url.includes("/tasks/task-2?")) {
      return { body: { data: task("task-2", "board-2") } };
    }

    throw new Error(`Unexpected Asana request: ${call.method} ${call.url}`);
  });

  await assert.rejects(
    asana.addAsanaDependency({
      scope,
      boardId: "board-1",
      taskGid: "task-1",
      dependencyGid: "task-2",
    }),
    /not in authorized board/,
  );
  assert.equal(calls.some((call) => call.url.includes("addDependencies")), false);
});

test("getAsanaBoard refreshes the OAuth token once after a 401", async () => {
  let firstProjectRequest = true;
  const calls = installFetch((call) => {
    if (call.url.includes("/projects/board-1?") && firstProjectRequest) {
      firstProjectRequest = false;
      return { status: 401, body: { errors: [{ message: "expired" }] } };
    }
    if (call.url.includes("/-/oauth_token")) {
      return {
        body: {
          access_token: "refreshed-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        },
      };
    }
    if (call.url.includes("/projects/board-1?")) {
      return {
        body: {
          data: {
            gid: "board-1",
            name: "Board 1",
            workspace: { gid: "workspace-1", name: "Workspace" },
          },
        },
      };
    }

    throw new Error(`Unexpected Asana request: ${call.method} ${call.url}`);
  });

  const result = await asana.getAsanaBoard({ scope, boardId: "board-1" });

  assert.equal(result.board.boardId, "board-1");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "POST", "GET"],
  );
  assert.equal(calls[2].url.includes("/projects/board-1?"), true);
});
