import { NextRequest, NextResponse } from "next/server";
import { completeAsanaNativeOAuth } from "@/lib/asana";
import { getAsanaMcpSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    code?: unknown;
  };
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!code) {
    return NextResponse.json({ error: "Asana authorization code is required." }, { status: 400 });
  }

  try {
    await completeAsanaNativeOAuth({ code });
    return NextResponse.json(getAsanaMcpSettings());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not connect Asana." },
      { status: 400 },
    );
  }
}
