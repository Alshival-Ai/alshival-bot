import {
  getAllGithubKnowledgeSources,
  getSlackWorkspaceSetting,
  updateGuildKnowledgeClonePath,
  updateGuildKnowledgeIndexMetadata,
  updateGuildKnowledgeMarkdownSnapshot,
  type GuildKnowledgeSource,
} from "./db.js";
import {
  buildMarkdownManifest,
  collectMarkdownFiles,
  diffMarkdownManifests,
  getMarkdownSignature,
  indexRepositoryMarkdown,
  parseMarkdownManifest,
  stringifyMarkdownManifest,
} from "./knowledgeIndex.js";
import { cloneOrUpdateRepo, getGuildRepoClonePath, getRepoContextPlatformFromPath } from "./repoClones.js";

const defaultSyncIntervalMs = 60 * 60 * 1000;
const defaultInitialDelayMs = 30 * 1000;

function configuredNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getSourceContextPlatform(source: GuildKnowledgeSource): "discord" | "slack" {
  const pathPlatform = getRepoContextPlatformFromPath(source.clonePath);

  if (pathPlatform) {
    return pathPlatform;
  }

  return getSlackWorkspaceSetting(source.guildId) ? "slack" : "discord";
}

function shouldFullReindex(input: {
  source: GuildKnowledgeSource;
  hadClone: boolean;
  previousManifest: ReturnType<typeof parseMarkdownManifest>;
  changedMarkdownPaths: string[];
}) {
  if (!input.hadClone || !input.source.indexedAt) {
    return true;
  }

  if (!input.previousManifest && input.changedMarkdownPaths.length > 0) {
    return true;
  }

  return false;
}

async function syncKnowledgeSource(source: GuildKnowledgeSource) {
  const platform = getSourceContextPlatform(source);
  const fallbackClonePath = getGuildRepoClonePath(source.guildId, source.repoFullName, platform);
  const clonePath = getRepoContextPlatformFromPath(source.clonePath) ? source.clonePath : fallbackClonePath;
  const clone = await cloneOrUpdateRepo({
    guildId: source.guildId,
    repoFullName: source.repoFullName,
    repoSshUrl: source.repoSshUrl,
    clonePath,
    platform,
  });

  if (clone.clonePath !== source.clonePath) {
    updateGuildKnowledgeClonePath({
      guildId: source.guildId,
      sourceId: source.id,
      clonePath: clone.clonePath,
    });
  }

  const files = await collectMarkdownFiles(clone.clonePath);
  const manifest = buildMarkdownManifest(files);
  const manifestJson = stringifyMarkdownManifest(manifest);
  const signature = getMarkdownSignature(manifest);
  const previousManifest = parseMarkdownManifest(source.markdownManifest);
  const previousSignature = source.markdownSignature;

  if (previousSignature === signature && previousManifest) {
    return {
      sourceId: source.id,
      repoFullName: source.repoFullName,
      platform,
      action: "skipped",
      markdownFiles: files.length,
      embeddedChunks: 0,
    };
  }

  const fullReindex = shouldFullReindex({
    source,
    hadClone: clone.existed,
    previousManifest,
    changedMarkdownPaths: clone.changedMarkdownPaths,
  });

  if (!previousManifest && !fullReindex && source.indexedAt) {
    updateGuildKnowledgeMarkdownSnapshot({
      guildId: source.guildId,
      sourceId: source.id,
      clonePath: clone.clonePath,
      markdownSignature: signature,
      markdownManifest: manifestJson,
    });

    return {
      sourceId: source.id,
      repoFullName: source.repoFullName,
      platform,
      action: "snapshotted",
      markdownFiles: files.length,
      embeddedChunks: 0,
    };
  }

  const diff = diffMarkdownManifests(previousManifest, manifest);
  const indexResult = await indexRepositoryMarkdown({
    contextId: source.guildId,
    sourceId: source.id,
    repoFullName: source.repoFullName,
    clonePath: clone.clonePath,
    platform,
    files,
    changedOrAddedPaths: fullReindex ? undefined : diff.changedOrAdded,
    removedPaths: fullReindex ? undefined : diff.removed,
    replaceSource: fullReindex,
  });

  updateGuildKnowledgeIndexMetadata({
    guildId: source.guildId,
    sourceId: source.id,
    vectorCollection: indexResult.collectionName,
    indexedMarkdownFiles: indexResult.markdownFiles,
    indexedChunks: indexResult.chunks,
    markdownSignature: signature,
    markdownManifest: manifestJson,
  });

  return {
    sourceId: source.id,
    repoFullName: source.repoFullName,
    platform,
    action: fullReindex ? "reindexed" : "updated",
    markdownFiles: indexResult.markdownFiles,
    embeddedChunks: indexResult.embeddedChunks,
  };
}

export async function runKnowledgeSync() {
  const sources = getAllGithubKnowledgeSources();
  const results = [];

  for (const source of sources) {
    try {
      results.push(await syncKnowledgeSource(source));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown knowledge sync error.";
      results.push({
        sourceId: source.id,
        repoFullName: source.repoFullName,
        platform: getSourceContextPlatform(source),
        action: "error",
        error: message,
      });
      console.error(`Knowledge sync failed for ${source.repoFullName} (${source.guildId}): ${message}`);
    }
  }

  const updated = results.filter((result) => result.action === "updated" || result.action === "reindexed").length;
  const skipped = results.filter((result) => result.action === "skipped" || result.action === "snapshotted").length;
  const failed = results.filter((result) => result.action === "error").length;

  console.log(
    `Knowledge sync completed: ${updated} updated, ${skipped} unchanged, ${failed} failed, ${sources.length} total.`,
  );

  return { updated, skipped, failed, sources: sources.length, results };
}

export class KnowledgeSyncService {
  private interval: NodeJS.Timeout | null = null;
  private initialTimeout: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  start() {
    const intervalMs = configuredNumber("KNOWLEDGE_SYNC_INTERVAL_MS", defaultSyncIntervalMs);
    const initialDelayMs = configuredNumber("KNOWLEDGE_SYNC_INITIAL_DELAY_MS", defaultInitialDelayMs);

    if (this.interval || this.initialTimeout) {
      return;
    }

    this.initialTimeout = setTimeout(() => {
      this.initialTimeout = null;
      void this.run();
    }, initialDelayMs);
    this.interval = setInterval(() => {
      void this.run();
    }, intervalMs);
  }

  stop() {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async run() {
    if (this.running) {
      return this.running;
    }

    this.running = runKnowledgeSync().finally(() => {
      this.running = null;
    });

    return this.running;
  }
}
