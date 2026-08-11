import { readdir, stat } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";

const gzipAsync = promisify(gzip);
const DIST = new URL("../dist/", import.meta.url);
const LIMIT_BYTES = 600 * 1024;

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesIn(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

async function main() {
  let files;
  try {
    files = await filesIn(DIST.pathname);
  } catch (error) {
    throw new Error(`dist is missing; run npm run build first (${String(error)})`);
  }

  const assets = files.filter((file) => /\.(?:js|css)$/u.test(file));
  let total = 0;
  for (const file of assets) {
    const source = await stat(file).then(async () => {
      const { readFile } = await import("node:fs/promises");
      return readFile(file);
    });
    total += (await gzipAsync(source)).byteLength;
  }

  console.log(`DOPPAN JavaScript+CSS gzip: ${total} bytes (limit ${LIMIT_BYTES} bytes)`);
  if (total > LIMIT_BYTES) {
    throw new Error("DOPPAN JavaScript+CSS gzip size exceeds 600 KiB");
  }
}

await main();
