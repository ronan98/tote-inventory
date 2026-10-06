import { writeFileSync, statSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { closeDatabase } from "./lib/db";
import { processAIRun } from "./lib/ai-service";
import { nextQueuedAIRunId } from "./lib/ai";
import { tmpdir } from "node:os";
import path from "node:path";

const heartbeat = process.env.AI_WORKER_HEARTBEAT_PATH || path.join(tmpdir(), "inventory-ai-worker-heartbeat");
if (process.argv.includes("--health")) {
  try { process.exit(Date.now() - statSync(heartbeat).mtimeMs < 45000 ? 0 : 1); }
  catch { process.exit(1); }
}
let stopping = false;
let healthy = false;
const idle = new AbortController();
function stop() { stopping = true; idle.abort(); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
function beat() {
  if (healthy) try { writeFileSync(heartbeat, String(Date.now()), { mode: 0o600 }); }
  catch { healthy = false; }
}
const timer = setInterval(beat, 15000);
async function main() {
  if (!process.env.AI_URL) throw new Error("The AI worker needs a local AI_URL.");
  console.log("Local AI photo queue worker started.");
  try {
    while (!stopping) {
      let processed = false;
      try {
        const id = nextQueuedAIRunId();
        healthy = true;
        beat();
        processed = id ? await processAIRun(id) : false;
        healthy = true;
        beat();
      } catch (error) {
        healthy = false;
        console.error("Photo queue worker failed", { kind: error instanceof Error ? error.name : "unknown" });
      }
      if (!processed && !stopping) {
        try { await wait(2000, undefined, { signal: idle.signal }); }
        catch { if (!stopping) throw new Error("Photo queue wait failed."); }
      }
    }
  } finally {
    clearInterval(timer);
    closeDatabase();
    console.log("Local AI photo queue worker stopped.");
  }
}
main().catch(error => {
  clearInterval(timer);
  console.error("Photo queue worker stopped unexpectedly", { kind: error instanceof Error ? error.name : "unknown" });
  process.exitCode = 1;
});
