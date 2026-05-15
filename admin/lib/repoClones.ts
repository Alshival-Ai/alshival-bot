import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getGithubSshKeyMetadata } from "@/lib/db";

const execFileAsync = promisify(execFile);

const agentHome = process.env.AGENT_HOME ?? path.dirname(process.env.BOT_DB_PATH ?? path.join(process.cwd(), "bot.db"));
const guildRoot = path.join(agentHome, "platform", "Discord", "Guilds");

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

export function getGuildRepoClonePath(guildId: string, repoFullName: string) {
  assertSafeId(guildId, "Discord guild ID");
  return path.join(guildRoot, guildId, "Knowledge", "GitHub", repoDirectoryName(repoFullName));
}

export async function cloneOrUpdateRepo(input: {
  guildId: string;
  repoFullName: string;
  repoSshUrl: string;
}) {
  const clonePath = getGuildRepoClonePath(input.guildId, input.repoFullName);
  const parentPath = path.dirname(clonePath);
  const sshCommand = getSshCommand();

  await fs.mkdir(parentPath, { recursive: true });

  if (await pathExists(path.join(clonePath, ".git"))) {
    await execFileAsync("git", ["-C", clonePath, "fetch", "origin", "--prune"], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand },
    });
    const { stdout } = await execFileAsync("git", ["-C", clonePath, "ls-remote", "--symref", "origin", "HEAD"], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand },
    });
    const defaultBranch = stdout.match(/refs\/heads\/([^\t\n]+)\s+HEAD/)?.[1];

    if (defaultBranch) {
      await execFileAsync("git", ["-C", clonePath, "checkout", "-B", defaultBranch, `origin/${defaultBranch}`]);
      await execFileAsync("git", ["-C", clonePath, "reset", "--hard", `origin/${defaultBranch}`]);
      await execFileAsync("git", ["-C", clonePath, "clean", "-fd"]);
    }

    return clonePath;
  }

  if (await pathExists(clonePath)) {
    throw new Error(`Clone path already exists and is not a git repository: ${clonePath}`);
  }

  await execFileAsync("git", ["clone", input.repoSshUrl, clonePath], {
    env: { ...process.env, GIT_SSH_COMMAND: sshCommand },
  });

  return clonePath;
}

export async function deleteRepoClone(clonePath: string) {
  const resolvedClonePath = path.resolve(clonePath);
  const resolvedGuildRoot = path.resolve(guildRoot);

  if (!resolvedClonePath.startsWith(`${resolvedGuildRoot}${path.sep}`)) {
    throw new Error("Refusing to delete a path outside the guild knowledge directory.");
  }

  await fs.rm(resolvedClonePath, { force: true, recursive: true });
}
