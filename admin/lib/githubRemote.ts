export type NormalizedGithubRemote = {
  repoFullName: string;
  repoSshUrl: string;
  repoHtmlUrl: string;
};

function assertSafeGithubPart(value: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("GitHub remote contains unsupported repository characters.");
  }
}

export function normalizeGithubRemoteOrigin(value: string): NormalizedGithubRemote {
  const remote = value.trim();
  const match =
    remote.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i) ??
    remote.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i) ??
    remote.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[/?#].*)?$/i);

  if (!match) {
    throw new Error("Remote origin must be a GitHub HTTPS or SSH URL.");
  }

  const owner = match[1];
  const repo = match[2];

  assertSafeGithubPart(owner);
  assertSafeGithubPart(repo);

  const repoFullName = `${owner}/${repo}`;

  return {
    repoFullName,
    repoSshUrl: `git@github.com:${repoFullName}.git`,
    repoHtmlUrl: `https://github.com/${repoFullName}`,
  };
}
