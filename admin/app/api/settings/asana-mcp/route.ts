import { NextRequest, NextResponse } from "next/server";
import {
  deleteAsanaMcpSettings,
  getAsanaMcpSettings,
  saveAsanaMcpSettings,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getAsanaMcpSettings());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    clientId?: unknown;
    clientSecret?: unknown;
  };

  return NextResponse.json(
    saveAsanaMcpSettings({
      clientId: typeof body.clientId === "string" ? body.clientId : "",
      clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : "",
    }),
  );
}

export function DELETE() {
  return NextResponse.json(deleteAsanaMcpSettings());
}
