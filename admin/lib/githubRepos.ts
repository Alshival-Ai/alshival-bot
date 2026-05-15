import { getGithubAccessTokens } from "@/lib/db";

export type GithubRepoSummary = {
  id: number;
  fullName: string;
  private: boolean;
  sshUrl: string;
  htmlUrl: string;
  updatedAt: string;
  accessOrg: string;
};

async function requestGithubRepos(input: { token: string; org: string; page: number }) {
  const params = new URLSearchParams({
    per_page: "100",
    sort: "updated",
    affiliation: "owner,collaborator,organization_member",
    page: String(input.page),
  });
  const response = await fetch(`https://api.github.com/user/repos?${params.toString()}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "User-Agent": "alshival-admin",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  const data = (await response.json()) as
    | Array<{
        id: number;
        full_name: string;
        private: boolean;
        ssh_url: string;
        html_url: string;
        updated_at: string;
      }>
    | { message?: string };

  if (!response.ok || !Array.isArray(data)) {
    throw new Error(
      "message" in data && data.message
        ? `GitHub token for ${input.org} failed: ${data.message}`
        : `Could not load GitHub repos for ${input.org}.`,
    );
  }

  return data.map((repo) => ({
    id: repo.id,
    fullName: repo.full_name,
    private: repo.private,
    sshUrl: repo.ssh_url,
    htmlUrl: repo.html_url,
    updatedAt: repo.updated_at,
    accessOrg: input.org,
  })) satisfies GithubRepoSummary[];
}

export async function getGithubRepos() {
  const tokens = getGithubAccessTokens();

  if (tokens.length === 0) {
    throw new Error("At least one GitHub personal access token is required.");
  }

  const reposByFullName = new Map<string, GithubRepoSummary>();
  const errors: string[] = [];

  for (const token of tokens) {
    try {
      for (let page = 1; page <= 10; page += 1) {
        const repos = await requestGithubRepos({
          token: token.personalAccessToken,
          org: token.org,
          page,
        });

        for (const repo of repos) {
          reposByFullName.set(repo.fullName, repo);
        }

        if (repos.length < 100) {
          break;
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Could not load GitHub repos for ${token.org}.`);
    }
  }

  const repos = [...reposByFullName.values()].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );

  if (repos.length === 0 && errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  return repos;
}
