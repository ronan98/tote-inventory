import { build } from "esbuild";
await build({
  entryPoints: ["src/worker.ts"],
  outfile: ".next/ai-worker.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["better-sqlite3", "sharp", "heic-decode"],
  logLevel: "warning",
});
