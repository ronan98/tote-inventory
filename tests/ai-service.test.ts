import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createTote, deleteTote, getTote, recordPhoto } from "../src/lib/inventory";
import { closeDatabase, getDatabase } from "../src/lib/db";
import { AI_MODEL, claimAIRun, completeAIRun, createAIRun, failAIRun, getAIState, nextQueuedAIRunId } from "../src/lib/ai";
import { processAIRun } from "../src/lib/ai-service";

test("local AI integration validates responses and never changes inventory", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-ai-service-"));
  process.env.INVENTORY_DATA_DIR = directory;
  process.env.APP_ORIGIN = "https://inventory.home.arpa";
  let result: unknown = { done: true, done_reason: "stop", message: { content: JSON.stringify({ items: [{ name: "Extension cord", quantity: 2, note: "Check the count." }] }) } };
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  let beforeChatResponse: (() => Promise<void>) | undefined;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += String(part);
    requests.push({ url: request.url!, body: JSON.parse(body) });
    if (request.url === "/api/chat" && beforeChatResponse) await beforeChatResponse();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url === "/api/generate" ? { done: true } : result));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.AI_URL = "http://127.0.0.1:" + address.port;
  const tote = createTote({ name: "Service test" });
  const photoId = randomUUID();
  await mkdir(path.join(directory, "photos", photoId));
  await writeFile(path.join(directory, "photos", photoId, "full.jpg"), await sharp({ create: { width: 1400, height: 1200, channels: 3, background: "green" } }).jpeg().toBuffer());
  recordPhoto(tote.id, { id: photoId, originalName: "test.jpg", mimeType: "image/jpeg" });
  function start() {
    const current = getTote(tote.id).tote;
    return createAIRun(tote.id, { photoId, contentsUpdatedAt: current.contentsUpdatedAt, force: true }).state.run!;
  }
  try {
    await t.test("sends bounded local image and structured output with immediate unloading", async () => {
      const run = start();
      await processAIRun(run.id);
      const state = getAIState(tote.id);
      assert.equal(state.run!.status, "ready");
      assert.equal(state.run!.suggestions[0].name, "Extension cord");
      assert.equal(getTote(tote.id).items.length, 0);
      const chat = requests.find(request => request.url === "/api/chat")!.body;
      assert.equal(chat.model, AI_MODEL);
      assert.equal(chat.keep_alive, 0);
      assert.equal(chat.think, false);
      assert.equal(chat.stream, false);
      const options = chat.options as Record<string, unknown>;
      assert.equal(options.num_thread, 2);
      assert.equal(options.num_gpu, 0);
      assert.equal(options.num_ctx, 4096);
      assert.ok(chat.format);
      const messages = chat.messages as { images?: string[] }[];
      const image = messages.find(message => message.images)!.images![0];
      const metadata = await sharp(Buffer.from(image, "base64")).metadata();
      assert.ok(metadata.width! <= 768 && metadata.height! <= 768);
      assert.equal(requests.filter(request => request.url === "/api/generate").length, 0);
    });
    await t.test("rejects truncation, invalid counts, and malformed JSON", async () => {
      for (const output of [
        { done: true, done_reason: "length", message: { content: '{"items":[]}' } },
        { done: true, done_reason: "stop", message: { content: '{"items":[{"name":"Cable","quantity":0,"note":""}]}' } },
        { done: true, done_reason: "stop", message: { content: "not JSON" } },
      ]) {
        result = output;
        const run = start();
        await processAIRun(run.id);
        assert.equal(getAIState(tote.id).run!.status, "failed");
        assert.equal(getTote(tote.id).items.length, 0);
      }
    });
    await t.test("deleting a tote during inference discards the late result without crashing or recreating data", async () => {
      const temporary = createTote({ name: "Delete during inference" });
      const temporaryPhoto = randomUUID();
      await mkdir(path.join(directory, "photos", temporaryPhoto));
      await writeFile(path.join(directory, "photos", temporaryPhoto, "full.jpg"), await sharp({ create: { width: 80, height: 60, channels: 3, background: "blue" } }).jpeg().toBuffer());
      const detail = recordPhoto(temporary.id, { id: temporaryPhoto, originalName: "temporary.jpg", mimeType: "image/jpeg" });
      const run = createAIRun(temporary.id, { photoId: temporaryPhoto, contentsUpdatedAt: detail.tote.contentsUpdatedAt }).state.run!;
      result = { done: true, done_reason: "stop", message: { content: '{"items":[{"name":"Late suggestion","quantity":1,"note":""}]}' } };
      let arrived!: () => void, release!: () => void;
      const received = new Promise<void>(resolve => { arrived = resolve; });
      const waiting = new Promise<void>(resolve => { release = resolve; });
      beforeChatResponse = async () => { arrived(); await waiting; };
      const processing = processAIRun(run.id);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([received, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Inference fixture did not start.")), 5000); })]);
        const waitingRun = start();
        deleteTote(temporary.id);
        assert.equal(getDatabase().prepare("SELECT id FROM ai_suggestion_runs WHERE id=?").get(run.id), undefined);
        assert.equal(nextQueuedAIRunId(), null);
        assert.equal(claimAIRun(waitingRun.id), null);
        release();
        assert.equal(await processing, true);
        assert.equal(getDatabase().prepare("SELECT id FROM totes WHERE id=?").get(temporary.id), undefined);
        assert.equal(getDatabase().prepare("SELECT id FROM ai_suggestion_runs WHERE id=?").get(run.id), undefined);
        assert.equal(getDatabase().prepare("SELECT id FROM items WHERE name='Late suggestion'").get(), undefined);
        assert.equal(nextQueuedAIRunId(), waitingRun.id);
        assert.ok(claimAIRun(waitingRun.id));
        failAIRun(run.id, "Late cleanup of deleted job");
        assert.ok(getDatabase().prepare("SELECT key FROM settings WHERE key=?").get("ai_inference_lease:" + waitingRun.id));
        completeAIRun(waitingRun.id, { items: [] });
      } finally {
        if (timer) clearTimeout(timer);
        release();
        beforeChatResponse = undefined;
        await processing;
      }
    });
    await t.test("configured external service URLs are refused before sending a photo", async () => {
      const before = requests.length;
      process.env.AI_URL = "https://external.example";
      const run = start();
      await processAIRun(run.id);
      assert.equal(getAIState(tote.id).run!.status, "failed");
      assert.equal(requests.length, before);
    });
  } finally {
    closeDatabase();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
    delete process.env.AI_URL;
  }
});
