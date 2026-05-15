import { NextResponse } from "next/server";
import { deleteGithubSshKey, getGithubSshKeyStatus } from "@/lib/githubSshKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getGithubSshKeyStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load GitHub SSH key status." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    return NextResponse.json(await deleteGithubSshKey());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete GitHub SSH key." },
      { status: 500 },
    );
  }
}
