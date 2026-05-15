import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspaceAgentConfig,
  getWorkspaceAgentConfig,
  saveWorkspaceAgentConfig,
} from "@/lib/db";
import { validateModelId } from "@/lib/modelValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  return NextResponse.json(getWorkspaceAgentConfig(workspaceId));
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const body = (await request.json()) as {
    provider?: unknown;
    model?: unknown;
    instructions?: unknown;
  };
  const provider = body.provider === "anthropic" ? "anthropic" : "openai";
  const model = typeof body.model === "string" ? body.model : "";

  try {
    await validateModelId(provider, model);

    return NextResponse.json(
      saveWorkspaceAgentConfig(workspaceId, {
        provider,
        model,
        instructions: typeof body.instructions === "string" ? body.instructions : "",
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save workspace agent settings." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  return NextResponse.json(deleteWorkspaceAgentConfig(workspaceId));
}
