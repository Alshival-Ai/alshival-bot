import { NextRequest, NextResponse } from "next/server";
import {
  deleteGuildAgentConfig,
  getGuildAgentConfig,
  saveGuildAgentConfig,
} from "@/lib/db";
import { validateModelId } from "@/lib/modelValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ guildId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  return NextResponse.json(getGuildAgentConfig(guildId));
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
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
      saveGuildAgentConfig(guildId, {
        provider,
        model,
        instructions: typeof body.instructions === "string" ? body.instructions : "",
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save guild agent settings." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  return NextResponse.json(deleteGuildAgentConfig(guildId));
}
