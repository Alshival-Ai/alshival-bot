import { NextResponse } from "next/server";
import { getAsanaNativeAuthorizeUrl } from "@/lib/asana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ authorizationUrl: getAsanaNativeAuthorizeUrl().toString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create Asana authorization URL." },
      { status: 400 },
    );
  }
}
