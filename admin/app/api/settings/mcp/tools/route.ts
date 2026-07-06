import { NextRequest, NextResponse } from "next/server";
import { deleteMcpToolSettings, getMcpToolSettings, saveMcpToolSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getMcpToolSettings());
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    gifSearch?: {
      enabled?: unknown;
      klipyApiKey?: unknown;
      queryPrefix?: unknown;
      defaultLimit?: unknown;
    };
  };
  const gifSearch = body.gifSearch ?? {};

  return NextResponse.json(
    saveMcpToolSettings({
      gifSearch: {
        enabled: gifSearch.enabled === true,
        klipyApiKey: typeof gifSearch.klipyApiKey === "string" ? gifSearch.klipyApiKey : "",
        queryPrefix: typeof gifSearch.queryPrefix === "string" ? gifSearch.queryPrefix : "",
        defaultLimit: typeof gifSearch.defaultLimit === "number" ? gifSearch.defaultLimit : 8,
      },
    }),
  );
}

export function DELETE() {
  return NextResponse.json(deleteMcpToolSettings());
}
