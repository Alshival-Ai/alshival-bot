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
import { normalizeGithubRemoteOrigin } from "@/lib/githubRemote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ guildId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  return NextResponse.json({ sources: getGuildKnowledgeSources(guildId) });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { guildId } = await context.params;
  const body = (await request.json()) as {
    repoFullName?: unknown;
    repoSshUrl?: unknown;
    repoHtmlUrl?: unknown;
    remoteOrigin?: unknown;
    private?: unknown;
  };
  let repo: ReturnType<typeof normalizeGithubRemoteOrigin> | null = null;

  try {
    repo =
      typeof body.remoteOrigin === "string" && body.remoteOrigin.trim()
        ? normalizeGithubRemoteOrigin(body.remoteOrigin)
        : typeof body.repoFullName === "string" &&
            typeof body.repoSshUrl === "string" &&
            typeof body.repoHtmlUrl === "string"
          ? {
              repoFullName: body.repoFullName,
              repoSshUrl: body.repoSshUrl,
              repoHtmlUrl: body.repoHtmlUrl,
            }
          : null;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid GitHub remote origin." },
      { status: 400 },
    );
  }

  if (!repo) {
    return NextResponse.json({ error: "Invalid GitHub repo knowledge source." }, { status: 400 });
  }

  try {
    const clonePath = await cloneOrUpdateRepo({
      guildId,
      repoFullName: repo.repoFullName,
      repoSshUrl: repo.repoSshUrl,
    });

    addGuildKnowledgeSource({
      guildId,
      repoFullName: repo.repoFullName,
      repoSshUrl: repo.repoSshUrl,
      repoHtmlUrl: repo.repoHtmlUrl,
      clonePath,
      private: body.private === true || typeof body.remoteOrigin === "string",
    });
    const source = getGuildKnowledgeSourceByRepo(guildId, repo.repoFullName);

    if (!source) {
      throw new Error("Could not save knowledge source metadata.");
    }

    const indexResult = await indexRepositoryMarkdown({
      guildId,
      sourceId: source.id,
      repoFullName: source.repoFullName,
      clonePath,
    });

    updateGuildKnowledgeIndexMetadata({
      guildId,
      sourceId: source.id,
      vectorCollection: indexResult.collectionName,
      indexedMarkdownFiles: indexResult.markdownFiles,
      indexedChunks: indexResult.chunks,
    });

    return NextResponse.json({
      sources: getGuildKnowledgeSources(guildId),
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
  const { guildId } = await context.params;
  const sourceId = Number(new URL(request.url).searchParams.get("sourceId"));

  if (!Number.isInteger(sourceId)) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  try {
    const source = getGuildKnowledgeSource(guildId, sourceId);

    if (source) {
      await deleteRepositoryVectors({ guildId, sourceId: source.id });
    }

    if (source?.clonePath) {
      await deleteRepoClone(source.clonePath);
    }

    return NextResponse.json({ sources: deleteGuildKnowledgeSource(guildId, sourceId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete knowledge source." },
      { status: 400 },
    );
  }
}
