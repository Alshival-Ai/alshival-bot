import { NextResponse } from "next/server";
import { getAsanaBoards } from "@/lib/asana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ boards: await getAsanaBoards() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Asana boards." },
      { status: 400 },
    );
  }
}
