import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { searchDirectoryCode } from "./codeSearchEngine.js";

test("searchDirectoryCode falls back when ripgrep is unavailable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alshival-code-search-"));
  const previousRipgrepPath = process.env.RIPGREP_PATH;

  try {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "split.ts"), "export const test_ids = ['APP-1', 'APP-2'];\n");
    await fs.writeFile(path.join(root, "src", "other.ts"), "export const train_ids = ['APP-3'];\n");
    process.env.RIPGREP_PATH = path.join(root, "missing-rg");

    const result = await searchDirectoryCode({
      repoFullName: "example/repo",
      clonePath: root,
      query: "test_ids",
      limit: 5,
    });

    assert.deepEqual(result, [
      {
        repoFullName: "example/repo",
        path: path.join("src", "split.ts"),
        line: 1,
        text: "export const test_ids = ['APP-1', 'APP-2'];",
      },
    ]);
  } finally {
    if (previousRipgrepPath === undefined) {
      delete process.env.RIPGREP_PATH;
    } else {
      process.env.RIPGREP_PATH = previousRipgrepPath;
    }

    await fs.rm(root, { recursive: true, force: true });
  }
});
