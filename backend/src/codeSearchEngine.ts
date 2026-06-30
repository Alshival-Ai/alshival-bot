import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultContextLines = 2;
const ignoredDirectoryNames = new Set([".git", ".next", "build", "dist", "node_modules"]);

export type CodeSearchMatch = {
  repoFullName: string;
  path: string;
  line: number | null;
  text: string;
};

function parseRipgrepLine(repoFullName: string, clonePath: string, line: string) {
  const first = line.indexOf(":");
  if (first < 0) {
    return null;
  }

  const second = line.indexOf(":", first + 1);
  if (second < 0) {
    return null;
  }

  const filePath = line.slice(0, first);
  const lineNumber = Number(line.slice(first + 1, second));
  const text = line.slice(second + 1).trim();

  return {
    repoFullName,
    path: path.relative(clonePath, filePath),
    line: Number.isFinite(lineNumber) ? lineNumber : null,
    text,
  };
}

function isExecutableMissing(error: unknown) {
  return (error as { code?: unknown }).code === "ENOENT";
}

function isNoMatches(error: unknown) {
  return (error as { code?: unknown }).code === 1;
}

async function searchDirectoryWithRipgrep(input: {
  repoFullName: string;
  clonePath: string;
  query: string;
  limit: number;
}) {
  const { stdout } = await execFileAsync(
    process.env.RIPGREP_PATH || "rg",
    [
      "--fixed-strings",
      "--ignore-case",
      "--line-number",
      "--with-filename",
      "--context",
      String(defaultContextLines),
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.git/**",
      "--glob",
      "!dist/**",
      "--glob",
      "!build/**",
      "--glob",
      "!.next/**",
      "--max-count",
      String(input.limit),
      input.query,
      input.clonePath,
    ],
    {
      maxBuffer: 1024 * 1024,
    },
  );

  const results: CodeSearchMatch[] = [];

  for (const line of stdout.split("\n")) {
    if (!line.trim() || line === "--") {
      continue;
    }

    const parsed = parseRipgrepLine(input.repoFullName, input.clonePath, line);
    if (parsed) {
      results.push(parsed);
    }

    if (results.length >= input.limit) {
      break;
    }
  }

  return results;
}

async function* walkSourceFiles(rootPath: string): AsyncGenerator<string> {
  let entries: Dirent[];

  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        yield* walkSourceFiles(entryPath);
      }
      continue;
    }

    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

async function readTextFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.includes("\0") ? null : content;
  } catch {
    return null;
  }
}

async function searchDirectoryWithNode(input: {
  repoFullName: string;
  clonePath: string;
  query: string;
  limit: number;
}) {
  const results: CodeSearchMatch[] = [];
  const needle = input.query.toLowerCase();

  for await (const filePath of walkSourceFiles(input.clonePath)) {
    const content = await readTextFile(filePath);
    if (content === null) {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(needle)) {
        continue;
      }

      results.push({
        repoFullName: input.repoFullName,
        path: path.relative(input.clonePath, filePath),
        line: index + 1,
        text: line.trim(),
      });

      if (results.length >= input.limit) {
        return results;
      }
    }
  }

  return results;
}

export async function searchDirectoryCode(input: {
  repoFullName: string;
  clonePath: string;
  query: string;
  limit: number;
}) {
  try {
    return await searchDirectoryWithRipgrep(input);
  } catch (error) {
    if (isNoMatches(error)) {
      return [];
    }

    if (isExecutableMissing(error)) {
      console.warn("ripgrep is unavailable; falling back to built-in code search.");
      return searchDirectoryWithNode(input);
    }

    throw error;
  }
}
