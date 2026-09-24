// Loads the facts a trailer is allowed to claim: from a GitHub repo via the
// REST API, or from a local checkout (README + package.json) before it ships.
// The logo is always a real one (org avatar or a file in the repo), or none.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface RepoLogo {
  /** https URL (org avatar) or absolute local path (brand file in the repo). */
  src: string;
  kind: "url" | "file";
}

export interface RepoFacts {
  name: string;
  slug: string;
  url: string;
  description: string;
  readme: string;
  language: string | null;
  stars: number | null;
  forks: number | null;
  topics: string[];
  license: string | null;
  homepage: string | null;
  logo: RepoLogo | null;
}

const README_CHARS = 6000;

export async function loadFacts(input: string): Promise<RepoFacts> {
  if (existsSync(input)) return fromLocal(resolve(input));
  const m = input.match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`Not a GitHub repo or local directory: ${input}`);
  return fromGitHub(m[1]!, m[2]!);
}

async function fromGitHub(owner: string, repo: string): Promise<RepoFacts> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "shipreel" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const meta = await fetch(api, { headers });
  if (!meta.ok) throw new Error(`GitHub ${owner}/${repo}: HTTP ${meta.status}`);
  const r = (await meta.json()) as {
    name: string; html_url: string; description: string | null; language: string | null;
    stargazers_count: number; forks_count: number; topics?: string[]; homepage: string | null;
    license?: { spdx_id?: string } | null; owner: { avatar_url: string; type: string };
  };
  const rd = await fetch(`${api}/readme`, { headers: { ...headers, Accept: "application/vnd.github.raw" } });
  // An organization's avatar is its logo; a personal avatar is a face, not a brand.
  const logo: RepoLogo | null = r.owner.type === "Organization"
    ? { src: `${r.owner.avatar_url}${r.owner.avatar_url.includes("?") ? "&" : "?"}s=512`, kind: "url" }
    : null;
  return {
    name: r.name,
    slug: `${owner}/${repo}`,
    url: r.html_url,
    description: r.description ?? "",
    readme: rd.ok ? (await rd.text()).slice(0, README_CHARS) : "",
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    topics: r.topics ?? [],
    license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : null,
    homepage: r.homepage || null,
    logo,
  };
}

function localLogo(dir: string): RepoLogo | null {
  const brand = join(dir, "brand");
  if (existsSync(brand)) {
    const svg = readdirSync(brand).filter((f) => f.endsWith(".svg")).sort()[0];
    if (svg) return { src: join(brand, svg), kind: "file" };
  }
  for (const f of ["logo.svg", "logo.png", "assets/logo.svg", "assets/logo.png"]) {
    if (existsSync(join(dir, f))) return { src: join(dir, f), kind: "file" };
  }
  return null;
}

function fromLocal(dir: string): RepoFacts {
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  const pkg = JSON.parse(read("package.json") || "{}") as {
    name?: string; description?: string; license?: string; homepage?: string; repository?: string | { url?: string };
  };
  const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
  // The README's H1 is how the project spells its own name; package names are lowercase by convention.
  const name = read("README.md").match(/^#\s+(.+)$/m)?.[1]?.trim() ?? pkg.name ?? basename(dir);
  const licenseHead = read("LICENSE").split("\n")[0] ?? "";
  return {
    name,
    slug: repoUrl.replace(/^.*github\.com\//, "").replace(/\.git$/, "") || name,
    url: repoUrl.replace(/^git\+/, "").replace(/\.git$/, ""),
    description: pkg.description ?? "",
    readme: read("README.md").slice(0, README_CHARS),
    language: existsSync(join(dir, "tsconfig.json")) ? "TypeScript" : null,
    stars: null,
    forks: null,
    topics: [],
    license: pkg.license ?? (/MIT License/.test(licenseHead) ? "MIT" : null),
    homepage: pkg.homepage ?? null,
    logo: localLogo(dir),
  };
}
