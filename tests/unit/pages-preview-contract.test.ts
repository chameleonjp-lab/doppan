import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/development-preview.yml", import.meta.url),
  "utf8",
);
const rootGuide = readFileSync(
  new URL("../../pages/root/root-guide.html", import.meta.url),
  "utf8",
);
const robots = readFileSync(new URL("../../pages/root/robots.txt", import.meta.url), "utf8");

describe("GitHub Pages development preview contract", () => {
  it("allows the current integrated G3 / GA branch only through the trusted preview path", () => {
    expect(workflow).toContain("default: agent/ga-clarity-pages-sync");
    expect(workflow).toContain("github.ref == 'refs/heads/agent/ga-clarity-pages-sync'");
    expect(workflow).toContain(
      "refs/heads/agent/g1a-technical-foundation|refs/heads/agent/g1b-physics-prototype|refs/heads/agent/vertical-slice|refs/heads/agent/ga-clarity-pages-sync",
    );
    expect(workflow).toContain("refs/remotes/origin/agent/ga-clarity-pages-sync");
    expect(workflow).toContain("refs/pull/*) exit 1");
  });

  it("publishes a verified Vite build below the root guide", () => {
    expect(workflow).toContain("mkdir -p _site/_preview/current");
    expect(workflow).toContain("cp pages/root/root-guide.html _site/index.html");
    expect(workflow).toContain("cp pages/root/robots.txt _site/robots.txt");
    expect(workflow).toContain("cp -R _verified-dist/. _site/_preview/current/");
    expect(workflow).toMatch(/uses: actions\/upload-pages-artifact@[0-9a-f]{40}/);
    expect(workflow).toMatch(/uses: actions\/deploy-pages@[0-9a-f]{40}/);
  });

  it("keeps the root guide non-interactive and asks crawlers not to index it", () => {
    expect(rootGuide).toContain("一般公開前");
    expect(rootGuide).not.toContain("<script");
    expect(rootGuide).not.toContain("<a ");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Disallow: /");
  });
});
