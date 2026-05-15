import { execFile } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  deleteGithubSshKeyMetadata,
  getGithubSshKeyMetadata,
  saveGithubSshKeyMetadata,
  type GithubSshKeyMetadata,
} from "@/lib/db";

const execFileAsync = promisify(execFile);

const agentHome = process.env.AGENT_HOME ?? path.dirname(process.env.BOT_DB_PATH ?? path.join(process.cwd(), "bot.db"));
const sshDir = path.join(agentHome, ".ssh");
const privateKeyPath = path.join(sshDir, "alshival_github");
const publicKeyPath = `${privateKeyPath}.pub`;

type SaveOptions = {
  replace: boolean;
};

export type GithubSshKeyStatus = GithubSshKeyMetadata & {
  configured: true;
};

export type EmptyGithubSshKeyStatus = {
  configured: false;
  privateKeyPath: string;
  publicKeyPath: string;
};

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureCanWriteKey({ replace }: SaveOptions) {
  const exists = await fileExists(privateKeyPath);

  if (exists && !replace) {
    throw new Error("A GitHub SSH key already exists. Use replace to overwrite it.");
  }

  await fs.mkdir(sshDir, { mode: 0o700, recursive: true });
  await fs.chmod(sshDir, 0o700);
}

async function fingerprintPublicKey(pubPath: string) {
  const { stdout } = await execFileAsync("ssh-keygen", ["-lf", pubPath]);
  return stdout.trim();
}

async function readMetadataFromFiles() {
  const publicKey = (await fs.readFile(publicKeyPath, "utf8")).trim();
  const fingerprint = await fingerprintPublicKey(publicKeyPath);
  const updatedAt = new Date().toISOString();

  return saveGithubSshKeyMetadata({
    privateKeyPath,
    publicKeyPath,
    publicKey,
    fingerprint,
    updatedAt,
  });
}

async function moveKeyFiles(tempPrivatePath: string, tempPublicPath: string) {
  await fs.rename(tempPrivatePath, privateKeyPath);
  await fs.rename(tempPublicPath, publicKeyPath);
  await fs.chmod(privateKeyPath, 0o600);
  await fs.chmod(publicKeyPath, 0o644);
}

export async function getGithubSshKeyStatus(): Promise<GithubSshKeyStatus | EmptyGithubSshKeyStatus> {
  const metadata = getGithubSshKeyMetadata();
  const privateExists = await fileExists(privateKeyPath);
  const publicExists = await fileExists(publicKeyPath);

  if (metadata && privateExists && publicExists) {
    return { ...metadata, configured: true };
  }

  if (privateExists && publicExists) {
    return { ...(await readMetadataFromFiles()), configured: true };
  }

  return {
    configured: false,
    privateKeyPath,
    publicKeyPath,
  };
}

export async function generateGithubSshKey(options: SaveOptions) {
  await ensureCanWriteKey(options);

  const tempPrivatePath = path.join(sshDir, `alshival_github.${Date.now()}.tmp`);
  const tempPublicPath = `${tempPrivatePath}.pub`;

  try {
    await execFileAsync("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "alshival-github",
      "-f",
      tempPrivatePath,
    ]);
    await moveKeyFiles(tempPrivatePath, tempPublicPath);
    return { ...(await readMetadataFromFiles()), configured: true };
  } catch (error) {
    await fs.rm(tempPrivatePath, { force: true });
    await fs.rm(tempPublicPath, { force: true });
    throw error;
  }
}

export async function uploadGithubSshKey(privateKey: string, options: SaveOptions) {
  const normalizedPrivateKey = privateKey.trimEnd();

  if (!normalizedPrivateKey.includes("PRIVATE KEY")) {
    throw new Error("Uploaded content does not look like a private key.");
  }

  await ensureCanWriteKey(options);

  const tempPrivatePath = path.join(sshDir, `alshival_github.${Date.now()}.upload.tmp`);
  const tempPublicPath = `${tempPrivatePath}.pub`;

  try {
    await fs.writeFile(tempPrivatePath, `${normalizedPrivateKey}\n`, { mode: 0o600 });
    await fs.chmod(tempPrivatePath, 0o600);
    const { stdout } = await execFileAsync("ssh-keygen", ["-y", "-f", tempPrivatePath]);
    const publicKey = stdout.trim();

    if (!publicKey.startsWith("ssh-")) {
      throw new Error("Could not derive a public key from the uploaded private key.");
    }

    await fs.writeFile(tempPublicPath, `${publicKey}\n`, { mode: 0o644 });
    await moveKeyFiles(tempPrivatePath, tempPublicPath);
    return { ...(await readMetadataFromFiles()), configured: true };
  } catch (error) {
    await fs.rm(tempPrivatePath, { force: true });
    await fs.rm(tempPublicPath, { force: true });
    throw error;
  }
}

export async function deleteGithubSshKey() {
  await fs.rm(privateKeyPath, { force: true });
  await fs.rm(publicKeyPath, { force: true });
  deleteGithubSshKeyMetadata();

  return getGithubSshKeyStatus();
}
