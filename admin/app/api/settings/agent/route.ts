import { NextRequest, NextResponse } from "next/server";
import { getAgentConfig, saveAgentConfig } from "@/lib/db";
import { validateModelId } from "@/lib/modelValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getAgentConfig());
}

export async function POST(request: NextRequest) {
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
      saveAgentConfig({
        provider,
        model,
        instructions: typeof body.instructions === "string" ? body.instructions : "",
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save agent settings." },
      { status: 400 },
    );
  }
}
