import { NextResponse } from "next/server";
import { getGithubRepos } from "@/lib/githubRepos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ repos: await getGithubRepos() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load GitHub repos." },
      { status: 400 },
    );
  }
}
