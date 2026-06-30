import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAsanaAuthorizeUrl } from "@/lib/asana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const origin = getPublicOrigin(request);
    const state = crypto.randomUUID();
    const authorizeUrl = getAsanaAuthorizeUrl({ origin, state });
    const response = NextResponse.redirect(authorizeUrl);

    response.cookies.set("asana_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      maxAge: 10 * 60,
      path: "/api/settings/asana-mcp",
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start Asana OAuth." },
      { status: 400 },
    );
  }
}

function getPublicOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get("host");

  if (host) {
    url.host = host;
  }

  if (url.hostname === "0.0.0.0") {
    url.hostname = "127.0.0.1";
  }

  return url.origin;
}
