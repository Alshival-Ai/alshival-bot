import { NextRequest, NextResponse } from "next/server";
import {
  addGuildKnowledgeSource,
  deleteGuildKnowledgeSource,
  getGuildKnowledgeSourceByRepo,
  getGuildKnowledgeSource,
  getGuildKnowledgeSources,
  updateGuildKnowledgeIndexMetadata,
} from "@/lib/db";
import { cloneOrUpdateRepo, deleteRepoClone } from "@/lib/repoClones";
import { deleteRepositoryVectors, indexRepositoryMarkdown } from "@/lib/vectorIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  return NextResponse.json({ sources: getGuildKnowledgeSources(workspaceId) });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const body = (await request.json()) as {
    repoFullName?: unknown;
    repoSshUrl?: unknown;
    repoHtmlUrl?: unknown;
    private?: unknown;
  };

  if (
    typeof body.repoFullName !== "string" ||
    typeof body.repoSshUrl !== "string" ||
    typeof body.repoHtmlUrl !== "string"
  ) {
    return NextResponse.json({ error: "Invalid GitHub repo knowledge source." }, { status: 400 });
  }

  try {
    const clonePath = await cloneOrUpdateRepo({
      guildId: workspaceId,
      repoFullName: body.repoFullName,
      repoSshUrl: body.repoSshUrl,
      platform: "slack",
    });

    addGuildKnowledgeSource({
      guildId: workspaceId,
      repoFullName: body.repoFullName,
      repoSshUrl: body.repoSshUrl,
      repoHtmlUrl: body.repoHtmlUrl,
      clonePath,
      private: body.private === true,
    });
    const source = getGuildKnowledgeSourceByRepo(workspaceId, body.repoFullName);

    if (!source) {
      throw new Error("Could not save knowledge source metadata.");
    }

    const indexResult = await indexRepositoryMarkdown({
      guildId: workspaceId,
      sourceId: source.id,
      repoFullName: source.repoFullName,
      clonePath,
      platform: "slack",
    });

    updateGuildKnowledgeIndexMetadata({
      guildId: workspaceId,
      sourceId: source.id,
      vectorCollection: indexResult.collectionName,
      indexedMarkdownFiles: indexResult.markdownFiles,
      indexedChunks: indexResult.chunks,
    });

    return NextResponse.json({
      sources: getGuildKnowledgeSources(workspaceId),
      index: indexResult,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not clone repository." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { workspaceId } = await context.params;
  const sourceId = Number(new URL(request.url).searchParams.get("sourceId"));

  if (!Number.isInteger(sourceId)) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  try {
    const source = getGuildKnowledgeSource(workspaceId, sourceId);

    if (source) {
      await deleteRepositoryVectors({ guildId: workspaceId, sourceId: source.id, platform: "slack" });
    }

    if (source?.clonePath) {
      await deleteRepoClone(source.clonePath);
    }

    return NextResponse.json({ sources: deleteGuildKnowledgeSource(workspaceId, sourceId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete knowledge source." },
      { status: 400 },
    );
  }
}
