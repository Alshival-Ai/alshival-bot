import { getGithubAccessToken } from "@/lib/db";

export type GithubRepoSummary = {
  id: number;
  fullName: string;
  private: boolean;
  sshUrl: string;
  htmlUrl: string;
  updatedAt: string;
};

export async function getGithubRepos() {
  const token = getGithubAccessToken();

  if (!token) {
    throw new Error("GitHub personal access token is not configured.");
  }

  const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
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
    throw new Error("message" in data && data.message ? data.message : "Could not load GitHub repos.");
  }

  return data.map((repo) => ({
    id: repo.id,
    fullName: repo.full_name,
    private: repo.private,
    sshUrl: repo.ssh_url,
    htmlUrl: repo.html_url,
    updatedAt: repo.updated_at,
  })) satisfies GithubRepoSummary[];
}
