import { NextRequest, NextResponse } from "next/server";
import {
  deleteAsanaChannelScope,
  getAsanaChannelScopes,
  saveAsanaChannelScope,
  type AsanaBoardScope,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ guildId: string }>;
};

function normalizeBoards(value: unknown): AsanaBoardScope[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const board = entry as {
            boardId?: unknown;
            boardName?: unknown;
            workspaceName?: unknown;
          };
          const boardId = typeof board.boardId === "string" ? board.boardId.trim() : "";

          if (!boardId) {
            return null;
          }

          return {
            boardId,
            boardName:
              typeof board.boardName === "string" && board.boardName.trim()
                ? board.boardName.trim()
                : null,
            workspaceName:
              typeof board.workspaceName === "string" && board.workspaceName.trim()
                ? board.workspaceName.trim()
                : null,
          };
        })
        .filter((entry): entry is AsanaBoardScope => entry !== null)
    : [];
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  return NextResponse.json({
    scopes: getAsanaChannelScopes({ platform: "discord", contextId: guildId }),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  const body = (await request.json()) as {
    channelId?: unknown;
    channelName?: unknown;
    mode?: unknown;
    boards?: unknown;
  };

  try {
    return NextResponse.json({
      scopes: saveAsanaChannelScope({
        platform: "discord",
        contextId: guildId,
        channelId: typeof body.channelId === "string" ? body.channelId : "",
        channelName: typeof body.channelName === "string" ? body.channelName : null,
        mode: body.mode === "specific" ? "specific" : "all",
        boards: normalizeBoards(body.boards),
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save Asana channel scope." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  const channelId = new URL(request.url).searchParams.get("channelId") ?? "";

  if (!channelId.trim()) {
    return NextResponse.json({ error: "channelId is required." }, { status: 400 });
  }

  return NextResponse.json({
    scopes: deleteAsanaChannelScope({
      platform: "discord",
      contextId: guildId,
      channelId,
    }),
  });
}
