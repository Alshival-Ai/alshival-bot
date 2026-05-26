import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeQueryOptions, diversifyBroadResults, type KnowledgeKbResult } from "./vectorSearch.js";

function result(repoFullName: string, relativePath: string, distance: number): KnowledgeKbResult["results"][number] {
  return {
    text: `${repoFullName}:${relativePath}`,
    distance,
    repoFullName,
    relativePath,
    sourceId: null,
    chunkIndex: null,
  };
}

test("buildKnowledgeQueryOptions scopes semantic search to a repo when requested", () => {
  assert.deepEqual(
    buildKnowledgeQueryOptions({
      queryEmbedding: [0.1, 0.2],
      limit: 5,
      repoFullName: "Alshival-Ai/utrgv-finance-onyx",
    }),
    {
      queryEmbeddings: [[0.1, 0.2]],
      nResults: 5,
      where: {
        repoFullName: "Alshival-Ai/utrgv-finance-onyx",
      },
    },
  );
});

test("buildKnowledgeQueryOptions over-fetches broad semantic searches", () => {
  assert.deepEqual(buildKnowledgeQueryOptions({ queryEmbedding: [0.3], limit: 5 }), {
    queryEmbeddings: [[0.3]],
    nResults: 20,
  });
});

test("diversifyBroadResults limits dominant repos and files before filling results", () => {
  const results = [
    result("large/repo", "README.md", 0.01),
    result("large/repo", "README.md", 0.02),
    result("large/repo", "README.md", 0.03),
    result("large/repo", "docs.md", 0.04),
    result("small/repo", "README.md", 0.05),
    result("other/repo", "README.md", 0.06),
  ];

  assert.deepEqual(
    diversifyBroadResults(results, 4).map((item) => item.text),
    ["large/repo:README.md", "large/repo:docs.md", "small/repo:README.md", "other/repo:README.md"],
  );
});
