/**
 * Compile WAT fixtures → fixtures/compiled/*.wasm using wabt.
 * Run: node lib/wasm-sandbox/fixtures/compile-fixtures.mjs
 */
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
let wabtInit;
try {
  wabtInit = (await import("wabt")).default;
} catch (err) {
  console.error("wabt is required to rebuild fixtures: npm i -D wabt");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watDir = path.join(__dirname, "wat");
const outDir = path.join(__dirname, "compiled");

const wabt = await wabtInit();
await mkdir(outDir, { recursive: true });

const files = (await readdir(watDir)).filter((f) => f.endsWith(".wat"));
for (const file of files) {
  const watPath = path.join(watDir, file);
  const source = await readFile(watPath, "utf8");
  const module = wabt.parseWat(file, source, {
    multi_memory: false,
  });
  module.resolveNames();
  module.validate();
  const { buffer } = module.toBinary({ log: false, write_debug_names: false });
  const outName = file.replace(/\.wat$/, ".wasm");
  const outPath = path.join(outDir, outName);
  await writeFile(outPath, Buffer.from(buffer));
  console.log(`compiled ${file} -> ${outName} (${buffer.length} bytes)`);
  module.destroy();
}
