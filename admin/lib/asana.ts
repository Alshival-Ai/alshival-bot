import crypto from "node:crypto";
import {
  getAsanaMcpSettingsPrivate,
  saveAsanaOAuthTokens,
  type AsanaBoardScope,
} from "@/lib/db";

type AsanaTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  data?: {
    gid?: string;
    id?: string;
    name?: string;
    email?: string;
  };
  errors?: Array<{ message?: string }>;
};

type AsanaSuccessfulTokenResponse = AsanaTokenResponse & {
  access_token: string;
};

type AsanaUserResponse = {
  data?: {
    gid?: string;
    name?: string;
    email?: string;
  };
  errors?: Array<{ message?: string }>;
};

type AsanaListResponse<T> = {
  data?: T[];
  next_page?: {
    uri?: string | null;
  } | null;
  errors?: Array<{ message?: string }>;
};

type AsanaWorkspace = {
  gid: string;
  name?: string;
};

type AsanaProject = {
  gid: string;
  name?: string;
  workspace?: {
    gid?: string;
    name?: string;
  };
};

const asanaApiBase = "https://app.asana.com/api/1.0";
const asanaTokenUrl = "https://app.asana.com/-/oauth_token";
const defaultScopes = process.env.ASANA_OAUTH_SCOPES ?? "default";
const nativeRedirectUri = "urn:ietf:wg:oauth:2.0:oob";

export function getAsanaRedirectUri(origin: string) {
  const url = new URL(origin);

  if (url.hostname === "0.0.0.0") {
    url.hostname = "127.0.0.1";
  }

  return `${url.origin}/api/settings/asana-mcp/callback`;
}

export function getAsanaAuthorizeUrl(input: {
  origin: string;
  state: string;
  redirectUri?: string;
}) {
  const settings = getAsanaMcpSettingsPrivate();

  if (!settings.clientId || !settings.clientSecret) {
    throw new Error("Asana client ID and client secret must be saved before connecting.");
  }

  const url = new URL(settings.authorizationUrl);
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri ?? getAsanaRedirectUri(input.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);

  if (defaultScopes.trim()) {
    url.searchParams.set("scope", defaultScopes.trim());
  }

  return url;
}

export function getAsanaNativeAuthorizeUrl() {
  return getAsanaAuthorizeUrl({
    origin: "http://localhost",
    state: crypto.randomUUID(),
    redirectUri: nativeRedirectUri,
  });
}

function asanaError(data: { errors?: Array<{ message?: string }> }, fallback: string) {
  return data.errors?.map((error) => error.message).filter(Boolean).join("; ") || fallback;
}

async function exchangeAsanaToken(input: {
  grantType: "authorization_code" | "refresh_token";
  code?: string;
  refreshToken?: string;
  redirectUri?: string;
}): Promise<AsanaSuccessfulTokenResponse> {
  const settings = getAsanaMcpSettingsPrivate();

  if (!settings.clientId || !settings.clientSecret) {
    throw new Error("Asana client ID and client secret are not configured.");
  }

  const body = new URLSearchParams({
    grant_type: input.grantType,
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
  });

  if (input.grantType === "authorization_code") {
    body.set("code", input.code ?? "");
    body.set("redirect_uri", input.redirectUri ?? "");
  } else {
    body.set("refresh_token", input.refreshToken ?? "");
  }

  const response = await fetch(asanaTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = (await response.json()) as AsanaTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(asanaError(data, "Asana OAuth token exchange failed."));
  }

  return data as AsanaSuccessfulTokenResponse;
}

async function requestAsanaJson<T>(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const data = (await response.json()) as T & { errors?: Array<{ message?: string }> };

  if (!response.ok) {
    throw new Error(asanaError(data, "Asana API request failed."));
  }

  return data;
}

async function getAsanaMe(accessToken: string) {
  return requestAsanaJson<AsanaUserResponse>(
    `${asanaApiBase}/users/me?opt_fields=gid,name,email`,
    accessToken,
  );
}

export async function completeAsanaOAuth(input: {
  code: string;
  origin: string;
}) {
  const token = await exchangeAsanaToken({
    grantType: "authorization_code",
    code: input.code,
    redirectUri: getAsanaRedirectUri(input.origin),
  });
  const accessToken = token.access_token;
  const me = await getAsanaMe(accessToken);

  return saveAsanaOAuthTokens({
    accessToken,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    user: me.data ?? token.data ?? null,
  });
}

export async function completeAsanaNativeOAuth(input: {
  code: string;
}) {
  const token = await exchangeAsanaToken({
    grantType: "authorization_code",
    code: input.code,
    redirectUri: nativeRedirectUri,
  });
  const accessToken = token.access_token;
  const me = await getAsanaMe(accessToken);

  return saveAsanaOAuthTokens({
    accessToken,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    user: me.data ?? token.data ?? null,
  });
}

async function refreshAsanaAccessToken(): Promise<string> {
  const settings = getAsanaMcpSettingsPrivate();

  if (!settings.refreshToken) {
    throw new Error("Asana is not connected. Connect with OAuth first.");
  }

  const token = await exchangeAsanaToken({
    grantType: "refresh_token",
    refreshToken: settings.refreshToken,
  });
  const accessToken = token.access_token;

  return saveAsanaOAuthTokens({
    accessToken,
    refreshToken: token.refresh_token ?? settings.refreshToken,
    expiresIn: token.expires_in,
  }).accessToken ?? accessToken;
}

export async function getAsanaAccessToken(): Promise<string> {
  const settings = getAsanaMcpSettingsPrivate();
  const expiresAt = settings.accessTokenExpiresAt ? Date.parse(settings.accessTokenExpiresAt) : 0;

  if (settings.accessToken && expiresAt > Date.now() + 60_000) {
    return settings.accessToken;
  }

  return refreshAsanaAccessToken();
}

async function getPaginatedAsanaData<T>(url: string, accessToken: string) {
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl !== null) {
    const currentUrl: string = nextUrl;
    const data: AsanaListResponse<T> = await requestAsanaJson<AsanaListResponse<T>>(currentUrl, accessToken);
    results.push(...(data.data ?? []));
    nextUrl = data.next_page?.uri ?? null;
  }

  return results;
}

export async function getAsanaBoards(): Promise<AsanaBoardScope[]> {
  const accessToken = await getAsanaAccessToken();
  const workspaces = await getPaginatedAsanaData<AsanaWorkspace>(
    `${asanaApiBase}/workspaces?limit=100&opt_fields=gid,name`,
    accessToken,
  );
  const projectsById = new Map<string, AsanaBoardScope>();

  for (const workspace of workspaces) {
    const projects = await getPaginatedAsanaData<AsanaProject>(
      `${asanaApiBase}/projects?limit=100&archived=false&workspace=${encodeURIComponent(
        workspace.gid,
      )}&opt_fields=gid,name,workspace.gid,workspace.name`,
      accessToken,
    );

    for (const project of projects) {
      projectsById.set(project.gid, {
        boardId: project.gid,
        boardName: project.name ?? null,
        workspaceName: project.workspace?.name ?? workspace.name ?? null,
      });
    }
  }

  return [...projectsById.values()].sort((left, right) =>
    `${left.workspaceName ?? ""}/${left.boardName ?? left.boardId}`.localeCompare(
      `${right.workspaceName ?? ""}/${right.boardName ?? right.boardId}`,
    ),
  );
}
