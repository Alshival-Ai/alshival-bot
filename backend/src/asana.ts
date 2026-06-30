import {
  getAsanaMcpSettingsUnsafe,
  saveAsanaOAuthTokens,
  type AsanaBoardScope,
  type AsanaChannelScope,
} from "./db.js";

type AsanaErrorResponse = {
  errors?: Array<{ message?: string }>;
};

type AsanaTokenResponse = AsanaErrorResponse & {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type AsanaSuccessfulTokenResponse = AsanaTokenResponse & {
  access_token: string;
};

type AsanaListResponse<T> = AsanaErrorResponse & {
  data?: T[];
  next_page?: {
    uri?: string | null;
  } | null;
};

type AsanaSingleResponse<T> = AsanaErrorResponse & {
  data?: T;
};

type AsanaWorkspace = {
  gid: string;
  name?: string;
};

type AsanaProject = {
  gid: string;
  name?: string;
  archived?: boolean;
  permalink_url?: string | null;
  workspace?: {
    gid?: string;
    name?: string;
  };
};

type AsanaTask = {
  gid?: string;
  name?: string;
  notes?: string;
  completed?: boolean;
  due_on?: string | null;
  due_at?: string | null;
  modified_at?: string | null;
  permalink_url?: string | null;
  assignee?: {
    gid?: string;
    name?: string;
    email?: string;
  } | null;
  memberships?: Array<{
    project?: {
      gid?: string;
      name?: string;
    } | null;
    section?: {
      gid?: string;
      name?: string;
    } | null;
  }>;
};

type AsanaSection = {
  gid?: string;
  name?: string;
};

type AsanaProjectStatus = {
  gid?: string;
  title?: string;
  color?: string;
  text?: string;
  created_at?: string;
  author?: {
    name?: string;
  } | null;
};

type AsanaAttachment = {
  gid?: string;
  name?: string;
  download_url?: string | null;
  view_url?: string | null;
  created_at?: string;
  size?: number;
};

type AsanaStory = {
  gid?: string;
  type?: string;
  text?: string;
  created_at?: string;
  created_by?: {
    gid?: string;
    name?: string;
    email?: string;
  } | null;
};

type AsanaUser = {
  gid?: string;
  name?: string;
  email?: string;
};

class AsanaApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const asanaApiBase = "https://app.asana.com/api/1.0";
const asanaTokenUrl = "https://app.asana.com/-/oauth_token";
const taskFields = [
  "gid",
  "name",
  "notes",
  "completed",
  "due_on",
  "due_at",
  "modified_at",
  "permalink_url",
  "assignee.gid",
  "assignee.name",
  "assignee.email",
  "memberships.project.gid",
  "memberships.project.name",
  "memberships.section.gid",
  "memberships.section.name",
].join(",");

function asanaError(data: AsanaErrorResponse, fallback: string) {
  return data.errors?.map((error) => error.message).filter(Boolean).join("; ") || fallback;
}

function clampLimit(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(value), max));
}

function requiredTrimmed(value: string, name: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}

function optionalText(value?: string | null) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return value.trim();
}

function optionalNullableText(value?: string | null) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDueOn(value?: string | null) {
  const normalized = optionalNullableText(value);

  if (normalized && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("dueOn must be YYYY-MM-DD.");
  }

  return normalized;
}

async function exchangeRefreshToken(refreshToken: string): Promise<AsanaSuccessfulTokenResponse> {
  const settings = getAsanaMcpSettingsUnsafe();

  if (!settings.clientId || !settings.clientSecret) {
    throw new Error("Asana client ID and client secret are not configured.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    refresh_token: refreshToken,
  });
  const response = await fetch(asanaTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as AsanaTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(asanaError(data, "Asana OAuth token refresh failed."));
  }

  return data as AsanaSuccessfulTokenResponse;
}

async function refreshAsanaAccessToken() {
  const settings = getAsanaMcpSettingsUnsafe();

  if (!settings.refreshToken) {
    throw new Error("Asana is not connected. Connect Asana in admin settings first.");
  }

  const token = await exchangeRefreshToken(settings.refreshToken);
  return (
    saveAsanaOAuthTokens({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? settings.refreshToken,
      expiresIn: token.expires_in,
    }).accessToken ?? token.access_token
  );
}

async function getAsanaAccessToken() {
  const settings = getAsanaMcpSettingsUnsafe();
  const expiresAt = settings.accessTokenExpiresAt ? Date.parse(settings.accessTokenExpiresAt) : 0;

  if (settings.accessToken && expiresAt > Date.now() + 60_000) {
    return settings.accessToken;
  }

  return refreshAsanaAccessToken();
}

async function requestAsanaJson<T>(
  url: string,
  accessToken: string,
  init?: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
  },
) {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await response.json()) as T & AsanaErrorResponse;

  if (!response.ok) {
    throw new AsanaApiError(response.status, asanaError(data, "Asana API request failed."));
  }

  return data;
}

async function requestAsanaJsonWithRefresh<T>(
  url: string,
  init?: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
  },
) {
  const accessToken = await getAsanaAccessToken();

  try {
    return await requestAsanaJson<T>(url, accessToken, init);
  } catch (error) {
    if (!(error instanceof AsanaApiError) || error.status !== 401) {
      throw error;
    }

    const refreshedToken = await refreshAsanaAccessToken();
    return requestAsanaJson<T>(url, refreshedToken, init);
  }
}

async function getPaginatedAsanaData<T>(url: string, maxItems: number) {
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl !== null && results.length < maxItems) {
    const currentUrl: string = nextUrl;
    const data = await requestAsanaJsonWithRefresh<AsanaListResponse<T>>(currentUrl);
    results.push(...(data.data ?? []));
    nextUrl = data.next_page?.uri ?? null;
  }

  return results.slice(0, maxItems);
}

function requireBoardAccess(scope: AsanaChannelScope, boardId: string) {
  const resolvedBoardId = boardId.trim();

  if (!resolvedBoardId) {
    throw new Error("boardId is required.");
  }

  if (scope.mode === "specific" && !scope.boards.some((board) => board.boardId === resolvedBoardId)) {
    throw new Error(`This channel is not authorized to access Asana board ${resolvedBoardId}.`);
  }

  return resolvedBoardId;
}

function assertTaskBelongsToBoard(task: AsanaTask, boardId: string) {
  const memberships = task.memberships ?? [];

  if (!memberships.some((membership) => membership.project?.gid === boardId)) {
    throw new Error(`Asana task ${task.gid ?? ""} is not in authorized board ${boardId}.`);
  }
}

function formatTask(task: AsanaTask) {
  return {
    gid: task.gid ?? null,
    name: task.name ?? null,
    notes: task.notes ?? null,
    completed: Boolean(task.completed),
    dueOn: task.due_on ?? null,
    dueAt: task.due_at ?? null,
    modifiedAt: task.modified_at ?? null,
    permalinkUrl: task.permalink_url ?? null,
    assignee: task.assignee
      ? {
          gid: task.assignee.gid ?? null,
          name: task.assignee.name ?? null,
          email: task.assignee.email ?? null,
        }
      : null,
    memberships: (task.memberships ?? []).map((membership) => ({
      projectId: membership.project?.gid ?? null,
      projectName: membership.project?.name ?? null,
      sectionId: membership.section?.gid ?? null,
      sectionName: membership.section?.name ?? null,
    })),
  };
}

async function fetchTask(taskGid: string) {
  const resolvedTaskGid = taskGid.trim();

  if (!resolvedTaskGid) {
    throw new Error("taskGid is required.");
  }

  const url = `${asanaApiBase}/tasks/${encodeURIComponent(resolvedTaskGid)}?opt_fields=${encodeURIComponent(
    taskFields,
  )}`;
  const data = await requestAsanaJsonWithRefresh<AsanaSingleResponse<AsanaTask>>(url);

  if (!data.data) {
    throw new Error(`Asana task ${resolvedTaskGid} was not found.`);
  }

  return data.data;
}

async function fetchBoard(boardId: string) {
  const resolvedBoardId = requiredTrimmed(boardId, "boardId");
  const url = `${asanaApiBase}/projects/${encodeURIComponent(
    resolvedBoardId,
  )}?opt_fields=gid,name,archived,permalink_url,workspace.gid,workspace.name`;
  const data = await requestAsanaJsonWithRefresh<AsanaSingleResponse<AsanaProject>>(url);

  if (!data.data) {
    throw new Error(`Asana board ${resolvedBoardId} was not found.`);
  }

  return data.data;
}

function formatBoard(board: AsanaProject) {
  return {
    boardId: board.gid,
    boardName: board.name ?? null,
    archived: Boolean(board.archived),
    permalinkUrl: board.permalink_url ?? null,
    workspace: board.workspace
      ? {
          gid: board.workspace.gid ?? null,
          name: board.workspace.name ?? null,
        }
      : null,
  };
}

async function fetchProjectSections(boardId: string) {
  return getPaginatedAsanaData<AsanaSection>(
    `${asanaApiBase}/projects/${encodeURIComponent(boardId)}/sections?limit=100&opt_fields=gid,name`,
    200,
  );
}

async function requireSectionInBoard(boardId: string, sectionId: string) {
  const resolvedSectionId = requiredTrimmed(sectionId, "sectionId");
  const sections = await fetchProjectSections(boardId);

  if (!sections.some((section) => section.gid === resolvedSectionId)) {
    throw new Error(`Asana section ${resolvedSectionId} is not in authorized board ${boardId}.`);
  }

  return resolvedSectionId;
}

function formatStory(story: AsanaStory) {
  return {
    gid: story.gid ?? null,
    type: story.type ?? null,
    text: story.text ?? null,
    createdAt: story.created_at ?? null,
    createdBy: story.created_by
      ? {
          gid: story.created_by.gid ?? null,
          name: story.created_by.name ?? null,
          email: story.created_by.email ?? null,
        }
      : null,
  };
}

export async function listAsanaBoards(scope: AsanaChannelScope) {
  if (scope.mode === "specific") {
    return {
      ok: true,
      mode: scope.mode,
      boards: scope.boards,
    };
  }

  const workspaces = await getPaginatedAsanaData<AsanaWorkspace>(
    `${asanaApiBase}/workspaces?limit=100&opt_fields=gid,name`,
    500,
  );
  const projectsById = new Map<string, AsanaBoardScope>();

  for (const workspace of workspaces) {
    const projects = await getPaginatedAsanaData<AsanaProject>(
      `${asanaApiBase}/projects?limit=100&archived=false&workspace=${encodeURIComponent(
        workspace.gid,
      )}&opt_fields=gid,name,workspace.gid,workspace.name`,
      500,
    );

    for (const project of projects) {
      projectsById.set(project.gid, {
        boardId: project.gid,
        boardName: project.name ?? null,
        workspaceName: project.workspace?.name ?? workspace.name ?? null,
      });
    }
  }

  return {
    ok: true,
    mode: scope.mode,
    boards: [...projectsById.values()].sort((left, right) =>
      `${left.workspaceName ?? ""}/${left.boardName ?? left.boardId}`.localeCompare(
        `${right.workspaceName ?? ""}/${right.boardName ?? right.boardId}`,
      ),
    ),
  };
}

export async function getAsanaBoard(input: { scope: AsanaChannelScope; boardId: string }) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const board = await fetchBoard(boardId);

  return {
    ok: true,
    board: formatBoard(board),
  };
}

export async function listAsanaProjectTasks(input: {
  scope: AsanaChannelScope;
  boardId: string;
  includeCompleted?: boolean;
  limit?: number;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const limit = clampLimit(input.limit, 50, 100);
  const tasks = await getPaginatedAsanaData<AsanaTask>(
    `${asanaApiBase}/projects/${encodeURIComponent(boardId)}/tasks?limit=100&opt_fields=${encodeURIComponent(
      taskFields,
    )}`,
    input.includeCompleted ? limit : Math.max(limit * 3, limit),
  );
  const filtered = input.includeCompleted ? tasks : tasks.filter((task) => !task.completed);

  return {
    ok: true,
    boardId,
    resultCount: Math.min(filtered.length, limit),
    tasks: filtered.slice(0, limit).map(formatTask),
  };
}

export async function searchAsanaProjectTasks(input: {
  scope: AsanaChannelScope;
  boardId: string;
  query: string;
  includeCompleted?: boolean;
  limit?: number;
}) {
  const query = input.query.trim().toLowerCase();

  if (!query) {
    throw new Error("query is required.");
  }

  const boardId = requireBoardAccess(input.scope, input.boardId);
  const limit = clampLimit(input.limit, 20, 50);
  const tasks = await getPaginatedAsanaData<AsanaTask>(
    `${asanaApiBase}/projects/${encodeURIComponent(boardId)}/tasks?limit=100&opt_fields=${encodeURIComponent(
      taskFields,
    )}`,
    300,
  );
  const matches = tasks
    .filter((task) => input.includeCompleted || !task.completed)
    .filter((task) => `${task.name ?? ""}\n${task.notes ?? ""}`.toLowerCase().includes(query))
    .slice(0, limit);

  return {
    ok: true,
    boardId,
    query: input.query,
    resultCount: matches.length,
    tasks: matches.map(formatTask),
  };
}

export async function getAsanaTask(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const task = await fetchTask(input.taskGid);
  assertTaskBelongsToBoard(task, boardId);

  return {
    ok: true,
    boardId,
    task: formatTask(task),
  };
}

export async function listAsanaProjectSections(input: { scope: AsanaChannelScope; boardId: string }) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const sections = await fetchProjectSections(boardId);

  return {
    ok: true,
    boardId,
    sections: sections.map((section) => ({
      gid: section.gid ?? null,
      name: section.name ?? null,
    })),
  };
}

export async function getAsanaProjectStatus(input: { scope: AsanaChannelScope; boardId: string }) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const statuses = await getPaginatedAsanaData<AsanaProjectStatus>(
    `${asanaApiBase}/projects/${encodeURIComponent(
      boardId,
    )}/project_statuses?limit=5&opt_fields=gid,title,color,text,created_at,author.name`,
    5,
  );

  return {
    ok: true,
    boardId,
    latestStatus: statuses[0] ?? null,
    statuses,
  };
}

export async function getAsanaSubtasks(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const parentTask = await fetchTask(input.taskGid);
  assertTaskBelongsToBoard(parentTask, boardId);
  const subtasks = await getPaginatedAsanaData<AsanaTask>(
    `${asanaApiBase}/tasks/${encodeURIComponent(input.taskGid.trim())}/subtasks?limit=100&opt_fields=${encodeURIComponent(
      taskFields,
    )}`,
    100,
  );

  return {
    ok: true,
    boardId,
    taskGid: input.taskGid.trim(),
    subtasks: subtasks.map(formatTask),
  };
}

export async function getAsanaDependencies(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const task = await fetchTask(input.taskGid);
  assertTaskBelongsToBoard(task, boardId);
  const dependencies = await getPaginatedAsanaData<AsanaTask>(
    `${asanaApiBase}/tasks/${encodeURIComponent(input.taskGid.trim())}/dependencies?limit=100&opt_fields=gid,name,completed`,
    100,
  );

  return {
    ok: true,
    boardId,
    taskGid: input.taskGid.trim(),
    dependencies: dependencies.map((dependency) => ({
      gid: dependency.gid ?? null,
      name: dependency.name ?? null,
      completed: Boolean(dependency.completed),
    })),
  };
}

export async function getAsanaAttachments(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const task = await fetchTask(input.taskGid);
  assertTaskBelongsToBoard(task, boardId);
  const attachments = await getPaginatedAsanaData<AsanaAttachment>(
    `${asanaApiBase}/tasks/${encodeURIComponent(
      input.taskGid.trim(),
    )}/attachments?limit=100&opt_fields=gid,name,download_url,view_url,created_at,size`,
    100,
  );

  return {
    ok: true,
    boardId,
    taskGid: input.taskGid.trim(),
    attachments: attachments.map((attachment) => ({
      gid: attachment.gid ?? null,
      name: attachment.name ?? null,
      downloadUrl: attachment.download_url ?? null,
      viewUrl: attachment.view_url ?? null,
      createdAt: attachment.created_at ?? null,
      size: attachment.size ?? null,
    })),
  };
}

export async function listAsanaWorkspaceMembers(input: {
  scope: AsanaChannelScope;
  boardId: string;
  limit?: number;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const board = await fetchBoard(boardId);
  const workspaceGid = board.workspace?.gid;

  if (!workspaceGid) {
    throw new Error(`Asana board ${boardId} does not include a workspace.`);
  }

  const limit = clampLimit(input.limit, 100, 500);
  const members = await getPaginatedAsanaData<AsanaUser>(
    `${asanaApiBase}/workspaces/${encodeURIComponent(workspaceGid)}/users?limit=100&opt_fields=gid,name,email`,
    limit,
  );

  return {
    ok: true,
    boardId,
    workspace: {
      gid: workspaceGid,
      name: board.workspace?.name ?? null,
    },
    members: members.map((member) => ({
      gid: member.gid ?? null,
      name: member.name ?? null,
      email: member.email ?? null,
    })),
  };
}

export async function getAsanaTaskStories(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
  limit?: number;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const task = await fetchTask(input.taskGid);
  assertTaskBelongsToBoard(task, boardId);
  const limit = clampLimit(input.limit, 25, 100);
  const stories = await getPaginatedAsanaData<AsanaStory>(
    `${asanaApiBase}/tasks/${encodeURIComponent(
      input.taskGid.trim(),
    )}/stories?limit=100&opt_fields=gid,type,text,created_at,created_by.gid,created_by.name,created_by.email`,
    limit,
  );

  return {
    ok: true,
    boardId,
    taskGid: input.taskGid.trim(),
    stories: stories.map(formatStory),
  };
}

export async function createAsanaTask(input: {
  scope: AsanaChannelScope;
  boardId: string;
  name: string;
  notes?: string | null;
  dueOn?: string | null;
  assigneeGid?: string | null;
  sectionId?: string | null;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const name = requiredTrimmed(input.name, "name");
  const sectionId = optionalText(input.sectionId);

  if (sectionId) {
    await requireSectionInBoard(boardId, sectionId);
  }

  const data: Record<string, unknown> = {
    name,
    projects: [boardId],
  };
  const notes = optionalText(input.notes);
  const dueOn = normalizeDueOn(input.dueOn);
  const assignee = optionalNullableText(input.assigneeGid);

  if (notes !== undefined) {
    data.notes = notes;
  }
  if (dueOn !== undefined) {
    data.due_on = dueOn;
  }
  if (assignee !== undefined) {
    data.assignee = assignee;
  }

  const response = await requestAsanaJsonWithRefresh<AsanaSingleResponse<AsanaTask>>(
    `${asanaApiBase}/tasks?opt_fields=${encodeURIComponent(taskFields)}`,
    {
      method: "POST",
      body: { data },
    },
  );
  const taskGid = response.data?.gid;

  if (!taskGid) {
    throw new Error("Asana task creation did not return a task GID.");
  }

  if (sectionId) {
    await addTaskToSection({ boardId, taskGid, sectionId });
  }

  const task = await fetchTask(taskGid);
  assertTaskBelongsToBoard(task, boardId);

  return {
    ok: true,
    boardId,
    task: formatTask(task),
  };
}

export async function updateAsanaTask(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
  name?: string | null;
  notes?: string | null;
  completed?: boolean;
  dueOn?: string | null;
  assigneeGid?: string | null;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const taskGid = requiredTrimmed(input.taskGid, "taskGid");
  const existing = await fetchTask(taskGid);
  assertTaskBelongsToBoard(existing, boardId);

  const data: Record<string, unknown> = {};
  const name = optionalText(input.name);
  const notes = optionalText(input.notes);
  const dueOn = normalizeDueOn(input.dueOn);
  const assignee = optionalNullableText(input.assigneeGid);

  if (name !== undefined) {
    data.name = requiredTrimmed(name, "name");
  }
  if (notes !== undefined) {
    data.notes = notes;
  }
  if (typeof input.completed === "boolean") {
    data.completed = input.completed;
  }
  if (dueOn !== undefined) {
    data.due_on = dueOn;
  }
  if (assignee !== undefined) {
    data.assignee = assignee;
  }

  if (Object.keys(data).length === 0) {
    throw new Error("At least one task field must be provided.");
  }

  const response = await requestAsanaJsonWithRefresh<AsanaSingleResponse<AsanaTask>>(
    `${asanaApiBase}/tasks/${encodeURIComponent(taskGid)}?opt_fields=${encodeURIComponent(taskFields)}`,
    {
      method: "PUT",
      body: { data },
    },
  );
  const task = response.data ?? (await fetchTask(taskGid));
  assertTaskBelongsToBoard(task, boardId);

  return {
    ok: true,
    boardId,
    task: formatTask(task),
  };
}

export async function addAsanaTaskComment(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
  text: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const taskGid = requiredTrimmed(input.taskGid, "taskGid");
  const text = requiredTrimmed(input.text, "text");
  const task = await fetchTask(taskGid);
  assertTaskBelongsToBoard(task, boardId);
  const response = await requestAsanaJsonWithRefresh<AsanaSingleResponse<AsanaStory>>(
    `${asanaApiBase}/tasks/${encodeURIComponent(taskGid)}/stories?opt_fields=gid,type,text,created_at,created_by.gid,created_by.name,created_by.email`,
    {
      method: "POST",
      body: { data: { text } },
    },
  );

  return {
    ok: true,
    boardId,
    taskGid,
    story: response.data ? formatStory(response.data) : null,
  };
}

async function addTaskToSection(input: {
  boardId: string;
  taskGid: string;
  sectionId: string;
}) {
  await requireSectionInBoard(input.boardId, input.sectionId);
  await requestAsanaJsonWithRefresh<AsanaSingleResponse<unknown>>(
    `${asanaApiBase}/sections/${encodeURIComponent(input.sectionId)}/addTask`,
    {
      method: "POST",
      body: { data: { task: input.taskGid } },
    },
  );
}

export async function moveAsanaTaskToSection(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
  sectionId: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const taskGid = requiredTrimmed(input.taskGid, "taskGid");
  const sectionId = requiredTrimmed(input.sectionId, "sectionId");
  const task = await fetchTask(taskGid);
  assertTaskBelongsToBoard(task, boardId);
  await addTaskToSection({ boardId, taskGid, sectionId });
  const updatedTask = await fetchTask(taskGid);
  assertTaskBelongsToBoard(updatedTask, boardId);

  return {
    ok: true,
    boardId,
    sectionId,
    task: formatTask(updatedTask),
  };
}

export async function addAsanaDependency(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
  dependencyGid: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const taskGid = requiredTrimmed(input.taskGid, "taskGid");
  const dependencyGid = requiredTrimmed(input.dependencyGid, "dependencyGid");
  const task = await fetchTask(taskGid);
  const dependency = await fetchTask(dependencyGid);
  assertTaskBelongsToBoard(task, boardId);
  assertTaskBelongsToBoard(dependency, boardId);
  await requestAsanaJsonWithRefresh<AsanaSingleResponse<unknown>>(
    `${asanaApiBase}/tasks/${encodeURIComponent(taskGid)}/addDependencies`,
    {
      method: "POST",
      body: { data: { dependencies: [dependencyGid] } },
    },
  );

  return {
    ok: true,
    boardId,
    taskGid,
    dependencyGid,
  };
}

export async function removeAsanaDependency(input: {
  scope: AsanaChannelScope;
  boardId: string;
  taskGid: string;
  dependencyGid: string;
}) {
  const boardId = requireBoardAccess(input.scope, input.boardId);
  const taskGid = requiredTrimmed(input.taskGid, "taskGid");
  const dependencyGid = requiredTrimmed(input.dependencyGid, "dependencyGid");
  const task = await fetchTask(taskGid);
  const dependency = await fetchTask(dependencyGid);
  assertTaskBelongsToBoard(task, boardId);
  assertTaskBelongsToBoard(dependency, boardId);
  await requestAsanaJsonWithRefresh<AsanaSingleResponse<unknown>>(
    `${asanaApiBase}/tasks/${encodeURIComponent(taskGid)}/removeDependencies`,
    {
      method: "POST",
      body: { data: { dependencies: [dependencyGid] } },
    },
  );

  return {
    ok: true,
    boardId,
    taskGid,
    dependencyGid,
  };
}
