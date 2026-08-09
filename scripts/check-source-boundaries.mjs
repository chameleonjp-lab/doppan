import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const roots = [
  fileURLToPath(new URL("../src/", import.meta.url)),
  fileURLToPath(new URL("../tests/", import.meta.url)),
];
const files = (await Promise.all(roots.map((root) => sourceFiles(root)))).flat();
const violations = [];

for (const file of files) {
  const normalized = relative(repositoryRoot, file).split(sep).join("/");
  const source = await readFile(file, "utf8");

  if (
    normalized !== "src/loop/game-loop.ts" &&
    /\b(?:requestAnimationFrame|cancelAnimationFrame)\b/u.test(source)
  ) {
    violations.push(`${normalized}: frame scheduling belongs to src/loop/game-loop.ts`);
  }

  if (/from\s+["']pixi\.js(?:\/[^"']*)?["']|import\s*\(\s*["']pixi\.js(?:\/[^"']*)?["']\s*\)/u.test(source)) {
    if (!normalized.startsWith("src/rendering/")) {
      violations.push(`${normalized}: PixiJS imports belong to src/rendering/`);
    }
  }

  const namedPixiImports = source.matchAll(
    /import\s+(?:type\s+)?\{([^;]*?)\}\s+from\s+["']pixi\.js(?:\/[^"']*)?["']/gu,
  );
  for (const match of namedPixiImports) {
    if (/\b(?:Application|Ticker)\b/u.test(match[1] ?? "")) {
      violations.push(`${normalized}: Pixi Application/Ticker ownership is forbidden`);
    }
  }

  const namedPixiExports = source.matchAll(
    /export\s+(?:type\s+)?\{([^;]*?)\}\s+from\s+["']pixi\.js(?:\/[^"']*)?["']/gu,
  );
  for (const match of namedPixiExports) {
    if (/\b(?:Application|Ticker)\b/u.test(match[1] ?? "")) {
      violations.push(`${normalized}: Pixi Application/Ticker re-export is forbidden`);
    }
  }

  if (
    /import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s+["']pixi\.js(?:\/[^"']*)?["']/u.test(source) ||
    /import\s+[A-Za-z_$][\w$]*(?:\s*,\s*\{[^;]*\})?\s+from\s+["']pixi\.js(?:\/[^"']*)?["']/u.test(source) ||
    /import\s*\(\s*["']pixi\.js(?:\/[^"']*)?["']\s*\)/u.test(source)
  ) {
    violations.push(`${normalized}: PixiJS must use auditable named imports`);
  }

  if (
    /export\s+\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s+["']pixi\.js(?:\/[^"']*)?["']/u.test(source)
  ) {
    violations.push(`${normalized}: wildcard PixiJS re-exports are forbidden`);
  }

  if (/from\s+["']planck(?:\/[^"']*)?["']|import\s*\(\s*["']planck(?:\/[^"']*)?["']\s*\)/u.test(source)) {
    if (!normalized.startsWith("src/physics/") && !normalized.startsWith("tests/physics/")) {
      violations.push(`${normalized}: Planck imports belong to physics modules`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Source-boundary violations:\n${violations.join("\n")}`);
}

console.log(`Source boundaries OK (${files.length} TypeScript files)`);
