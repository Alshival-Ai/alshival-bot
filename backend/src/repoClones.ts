import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getGithubSshKeyMetadata } from "./db.js";

const execFileAsync = promisify(execFile);

const agentHome = process.env.AGENT_HOME ?? path.dirname(process.env.BOT_DB_PATH ?? path.join(process.cwd(), "..", "bot.db"));
const platformRoots = {
  discord: path.join(agentHome, "platform", "Discord", "Guilds"),
  slack: path.join(agentHome, "platform", "Slack", "Workspaces"),
};

function assertSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
}

function repoDirectoryName(repoFullName: string) {
  const parts = repoFullName.split("/");

  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("Invalid GitHub repository name.");
  }

  parts.forEach((part) => assertSafeId(part, "GitHub repository name"));
  return parts.join("__");
}

function getSshCommand() {
  const metadata = getGithubSshKeyMetadata();

  if (!metadata) {
    throw new Error("GitHub SSH key is not configured.");
  }

  return `ssh -i ${metadata.privateKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function git(args: string[], options?: { cwd?: string; sshCommand?: string }) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options?.cwd,
    env: options?.sshCommand ? { ...process.env, GIT_SSH_COMMAND: options.sshCommand } : process.env,
  });

  return stdout.trim();
}

export function getGuildRepoClonePath(
  guildId: string,
  repoFullName: string,
  platform: "discord" | "slack" = "discord",
) {
  assertSafeId(guildId, platform === "discord" ? "Discord guild ID" : "Slack workspace ID");
  return path.join(platformRoots[platform], guildId, "Knowledge", "GitHub", repoDirectoryName(repoFullName));
}

export function getRepoContextPlatformFromPath(clonePath: string): "discord" | "slack" | null {
  const resolved = path.resolve(clonePath);
  const slackRoot = path.resolve(platformRoots.slack);
  const discordRoot = path.resolve(platformRoots.discord);

  if (resolved.startsWith(`${slackRoot}${path.sep}`)) {
    return "slack";
  }

  if (resolved.startsWith(`${discordRoot}${path.sep}`)) {
    return "discord";
  }

  return null;
}

export async function cloneOrUpdateRepo(input: {
  guildId: string;
  repoFullName: string;
  repoSshUrl: string;
  clonePath?: string;
  platform?: "discord" | "slack";
}) {
  const platform = input.platform ?? "discord";
  const clonePath = input.clonePath || getGuildRepoClonePath(input.guildId, input.repoFullName, platform);
  const parentPath = path.dirname(clonePath);
  const sshCommand = getSshCommand();
  let existed = false;
  let beforeHead: string | null = null;
  let afterHead: string | null = null;
  let changedMarkdownPaths: string[] = [];

  await fs.mkdir(parentPath, { recursive: true });

  if (await pathExists(path.join(clonePath, ".git"))) {
    existed = true;
    beforeHead = await git(["-C", clonePath, "rev-parse", "HEAD"]).catch(() => null);
    await git(["-C", clonePath, "fetch", "origin", "--prune"], { sshCommand });
    const stdout = await git(["-C", clonePath, "ls-remote", "--symref", "origin", "HEAD"], {
      sshCommand,
    });
    const defaultBranch = stdout.match(/refs\/heads\/([^\t\n]+)\s+HEAD/)?.[1];

    if (defaultBranch) {
      await git(["-C", clonePath, "checkout", "-B", defaultBranch, `origin/${defaultBranch}`]);
      await git(["-C", clonePath, "reset", "--hard", `origin/${defaultBranch}`]);
      await git(["-C", clonePath, "clean", "-fd"]);
    }

    afterHead = await git(["-C", clonePath, "rev-parse", "HEAD"]).catch(() => null);

    if (beforeHead && afterHead && beforeHead !== afterHead) {
      const diff = await git([
        "-C",
        clonePath,
        "diff",
        "--name-only",
        beforeHead,
        afterHead,
        "--",
        "*.md",
        "*.mdx",
      ]);
      changedMarkdownPaths = diff ? diff.split("\n").filter(Boolean) : [];
    }

    return { clonePath, existed, beforeHead, afterHead, changedMarkdownPaths };
  }

  if (await pathExists(clonePath)) {
    throw new Error(`Clone path already exists and is not a git repository: ${clonePath}`);
  }

  await git(["clone", input.repoSshUrl, clonePath], { sshCommand });
  afterHead = await git(["-C", clonePath, "rev-parse", "HEAD"]).catch(() => null);

  return { clonePath, existed, beforeHead, afterHead, changedMarkdownPaths };
}
