// Real marks for the title and end cards: the repo's own logo, the GitHub
// mark, and the language icon (simple-icons). Nothing here is generated.

import { copyFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { RepoFacts } from "./source.ts";

const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons";
const LANGUAGE_SLUGS: Record<string, string> = {
  Go: "go", TypeScript: "typescript", JavaScript: "javascript", Rust: "rust", Python: "python",
  Java: "openjdk", "C++": "cplusplus", C: "c", "C#": "dotnet", Ruby: "ruby", PHP: "php", Swift: "swift",
  Kotlin: "kotlin", Dart: "dart", Elixir: "elixir", Haskell: "haskell", Scala: "scala", Shell: "gnubash",
  Lua: "lua", Zig: "zig", Solidity: "solidity", Vue: "vuedotjs", Svelte: "svelte", HTML: "html5", CSS: "css",
};

export interface Brand {
  /** Project-relative path of the repo's logo, if it has a real one. */
  logo: string | null;
  /** Avatars are square rasters and get app-icon rounding; SVG marks keep their own shape. */
  logoIsRaster: boolean;
  githubSvg: string | null;
  language: { name: string; svg: string | null } | null;
}

async function glyph(slug: string): Promise<string | null> {
  const res = await fetch(`${SIMPLE_ICONS}/${slug}.svg`).catch(() => null);
  if (!res?.ok) return null;
  return (await res.text()).replace(/<title>.*?<\/title>/, "").replace("<svg ", '<svg fill="currentColor" aria-hidden="true" ');
}

async function copyLogo(facts: RepoFacts, assetsDir: string): Promise<{ rel: string; raster: boolean } | null> {
  if (!facts.logo) return null;
  if (facts.logo.kind === "file") {
    const ext = extname(facts.logo.src).toLowerCase() || ".svg";
    copyFileSync(facts.logo.src, join(assetsDir, `logo${ext}`));
    return { rel: `assets/logo${ext}`, raster: ext !== ".svg" };
  }
  const res = await fetch(facts.logo.src).catch(() => null);
  if (!res?.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  const ext = type.includes("svg") ? ".svg" : type.includes("jpeg") ? ".jpg" : ".png";
  await Bun.write(join(assetsDir, `logo${ext}`), res);
  return { rel: `assets/logo${ext}`, raster: ext !== ".svg" };
}

export async function loadBrand(facts: RepoFacts, assetsDir: string): Promise<Brand> {
  const slug = facts.language ? LANGUAGE_SLUGS[facts.language] : undefined;
  const [logo, githubSvg, langSvg] = await Promise.all([
    copyLogo(facts, assetsDir),
    facts.url.includes("github.com") ? glyph("github") : Promise.resolve(null),
    slug ? glyph(slug) : Promise.resolve(null),
  ]);
  return {
    logo: logo?.rel ?? null,
    logoIsRaster: logo?.raster ?? false,
    githubSvg,
    language: facts.language ? { name: facts.language, svg: langSvg } : null,
  };
}
