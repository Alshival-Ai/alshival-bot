import { NextRequest, NextResponse } from "next/server";
import {
  deleteLanguageModelSettings,
  getLanguageModelSettings,
  saveLanguageModelSettings,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getLanguageModelSettings());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    provider?: unknown;
    openAiApiKey?: unknown;
    anthropicApiKey?: unknown;
  };

  return NextResponse.json(
    saveLanguageModelSettings({
      provider: typeof body.provider === "string" ? body.provider : "",
      openAiApiKey: typeof body.openAiApiKey === "string" ? body.openAiApiKey : "",
      anthropicApiKey: typeof body.anthropicApiKey === "string" ? body.anthropicApiKey : "",
    }),
  );
}

export function DELETE() {
  return NextResponse.json(deleteLanguageModelSettings());
}
