import { NextRequest, NextResponse } from "next/server";
import { generateGithubSshKey } from "@/lib/githubSshKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { replace?: unknown };
    return NextResponse.json(await generateGithubSshKey({ replace: body.replace === true }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate GitHub SSH key." },
      { status: 400 },
    );
  }
}
