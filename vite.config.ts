import { defineConfig, type Plugin } from "vite";

const buildEnvironment = process.env.VITE_BUILD_ENV ?? "development-preview";
const buildTarget = process.env.VITE_BUILD_TARGET ?? defaultBuildTarget(buildEnvironment);
const commitSha = process.env.VITE_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "unknown";
const buildAt = process.env.VITE_BUILD_AT ?? new Date().toISOString();

export function defaultBuildTarget(environment: string): string {
  if (environment === "production") {
    return "GitHub Pages / production";
  }
  if (environment === "test") {
    return "CI / test";
  }
  return "GitHub Pages / development-preview";
}

function buildInfoPlugin(): Plugin {
  return {
    name: "doppan-g1a-build-info",
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `    <meta name="doppan-build-environment" content="${escapeAttribute(buildEnvironment)}">\n` +
          `    <meta name="doppan-build-sha" content="${escapeAttribute(commitSha)}">\n` +
          `    <meta name="doppan-build-at" content="${escapeAttribute(buildAt)}">\n` +
          "  </head>",
      );
    },
  };
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export default defineConfig({
  publicDir: "public",
  base: "./",
  plugins: [buildInfoPlugin()],
  define: {
    "import.meta.env.VITE_BUILD_ENV": JSON.stringify(buildEnvironment),
    "import.meta.env.VITE_BUILD_TARGET": JSON.stringify(buildTarget),
    "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(commitSha),
    "import.meta.env.VITE_BUILD_AT": JSON.stringify(buildAt),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
