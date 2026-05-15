import { NextRequest, NextResponse } from "next/server";
import {
  deleteGithubAccessSettings,
  deleteGithubAccessToken,
  getGithubAccessSettings,
  saveGithubAccessSettings,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getGithubAccessSettings());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    oauthClientId?: unknown;
    personalAccessToken?: unknown;
    org?: unknown;
  };

  return NextResponse.json(
    saveGithubAccessSettings({
      oauthClientId: typeof body.oauthClientId === "string" ? body.oauthClientId : "",
      personalAccessToken:
        typeof body.personalAccessToken === "string" ? body.personalAccessToken : "",
      org: typeof body.org === "string" ? body.org : undefined,
    }),
  );
}

export function DELETE(request: NextRequest) {
  const tokenId = new URL(request.url).searchParams.get("tokenId");

  if (tokenId) {
    return NextResponse.json(deleteGithubAccessToken(tokenId));
  }

  return NextResponse.json(deleteGithubAccessSettings());
}
