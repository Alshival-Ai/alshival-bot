import { NextRequest, NextResponse } from "next/server";
import { generateAgentResponse } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { input?: unknown };

    return NextResponse.json(
      await generateAgentResponse(typeof body.input === "string" ? body.input : ""),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate agent response." },
      { status: 500 },
    );
  }
}
