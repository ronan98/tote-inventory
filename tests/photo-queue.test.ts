import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import Database from "better-sqlite3";
import sharp from "sharp";
import { closeDatabase, getDatabase } from "../src/lib/db";
import { addItems, archiveTote, createTote, deleteTote, getTote, recordPhoto } from "../src/lib/inventory";
import { acceptAISuggestions, claimAIRun, completeAIRun, createAIRun, dismissAISuggestions, getAIState, nextQueuedAIRunId } from "../src/lib/ai";
import { uploadPhoto } from "../src/lib/photos";

test("photo uploads feed a durable exclusive FIFO suggestion queue", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-photo-queue-"));
  process.env.APP_ORIGIN = "https://inventory.home.arpa";
  process.env.AI_URL = "http://127.0.0.1:11434";
  const sample = await sharp({create:{width:80,height:60,channels:3,background:"red"}}).jpeg().toBuffer();
  function fresh(name: string) {
    closeDatabase();
    process.env.INVENTORY_DATA_DIR = path.join(root, name);
  }
  async function upload(id: string, bytes: Buffer = sample) {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], "contents.jpg", {type:"image/jpeg"}));
    return uploadPhoto(id, new Request("https://inventory.home.arpa/api/totes/" + id + "/photos", {
      method:"POST",headers:{Origin:"https://inventory.home.arpa"},body:form,
    }));
  }
  function status(id: string) { return (getDatabase().prepare("SELECT status FROM ai_suggestion_runs WHERE id=?").get(id) as {status:string}).status; }
  const suggestions = {items:[{name:"Tape",quantity:1,note:""}]};
  try {
    await t.test("valid upload creates a job atomically; an enqueue error preserves the previous photo and history", async () => {
      fresh("atomic");
      const tote = createTote({name:"Upload queue"});
      const detail = await upload(tote.id);
      const run = getAIState(tote.id).run!;
      assert.equal(run.status, "queued");
      assert.equal(run.photoId, detail.tote.photo!.id);
      assert.equal(detail.items.length, 0);
      getDatabase().exec("CREATE TEMP TRIGGER reject_test_enqueue BEFORE INSERT ON ai_suggestion_runs BEGIN SELECT RAISE(ABORT,'test queue write failure'); END");
      try {
        await assert.rejects(upload(tote.id), /test queue write failure/);
        assert.deepEqual(getTote(tote.id), detail);
        assert.equal(getAIState(tote.id).run!.id, run.id);
        assert.equal((getDatabase().prepare("SELECT COUNT(*) AS count FROM photos").get() as {count:number}).count, 1);
      } finally { getDatabase().exec("DROP TRIGGER reject_test_enqueue"); }
      const malformed = new FormData();
      malformed.set("file",new File(["invalid image"],"bad.jpg"));
      await assert.rejects(uploadPhoto(tote.id,new Request("https://inventory.home.arpa/api/totes/" + tote.id + "/photos",{
        method:"POST",headers:{Origin:"https://inventory.home.arpa"},body:malformed,
      })));
      assert.equal(getAIState(tote.id).run!.id, run.id);
    });
    await t.test("waiting photos survive old timestamps and database reopening; the lease starts at claim", async () => {
      fresh("waiting");
      const tote = createTote({name:"Long wait"});
      await upload(tote.id);
      const run = getAIState(tote.id).run!;
      getDatabase().prepare("UPDATE ai_suggestion_runs SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z",run.id);
      closeDatabase();
      assert.equal(getAIState(tote.id).run!.status,"queued");
      assert.equal(getAIState(tote.id).run!.queuePosition,1);
      const claimed = claimAIRun(run.id)!;
      assert.ok(Date.parse(claimed.expires_at) > Date.now() + 300000);
      assert.equal(getAIState(tote.id).run!.queuePosition,null);
      completeAIRun(run.id,suggestions);
      closeDatabase();
      assert.equal(getAIState(tote.id).run!.status,"ready");
    });
    await t.test("new photo uploads create a visible review after the previous review was dismissed", async () => {
      fresh("replace-dismissed");
      const tote = createTote({ name: "Fresh visible suggestions" });
      await upload(tote.id);
      const old = getAIState(tote.id).run!;
      dismissAISuggestions(tote.id, { runId: old.id });
      assert.equal(getAIState(tote.id).run!.dismissed, true);
      await upload(tote.id);
      const next = getAIState(tote.id).run!;
      assert.notEqual(next.id, old.id);
      assert.equal(next.dismissed, false);
      assert.deepEqual(next.dismissedSuggestionIds, []);
      assert.equal(next.status, "queued");
      closeDatabase();
      assert.equal(getAIState(tote.id).run!.dismissed, false);
    });
    await t.test("replacing a pending photo cancels only that tote's old job and joins the queue tail", async () => {
      fresh("replace-waiting");
      const first = createTote({name:"First"});
      const second = createTote({name:"Second"});
      await upload(first.id);
      const old = getAIState(first.id).run!;
      await upload(second.id);
      const other = getAIState(second.id).run!;
      await upload(first.id);
      const replacement = getAIState(first.id).run!;
      assert.equal(status(old.id),"failed");
      assert.notEqual(old.photoId,replacement.photoId);
      assert.equal(getAIState(second.id).run!.queuePosition,1);
      assert.equal(replacement.queuePosition,2);
      assert.equal(nextQueuedAIRunId(),other.id);
      assert.equal(claimAIRun(replacement.id),null);
      assert.ok(claimAIRun(other.id));
      assert.equal(claimAIRun(replacement.id),null);
      completeAIRun(other.id,suggestions);
      assert.ok(claimAIRun(replacement.id));
      completeAIRun(replacement.id,suggestions);
      assert.equal(getTote(first.id).items.length,0);
    });
    await t.test("replacing a running photo preserves exclusivity, discards its result, and analyzes the new photo later", async () => {
      fresh("replace-running");
      const first = createTote({name:"Active"});
      const second = createTote({name:"Waiting"});
      await upload(first.id);
      const old = getAIState(first.id).run!;
      assert.ok(claimAIRun(old.id));
      await upload(second.id);
      const other = getAIState(second.id).run!;
      await upload(first.id);
      const latest = getAIState(first.id).run!;
      assert.equal(status(old.id),"running");
      assert.equal(latest.status,"queued");
      assert.equal(nextQueuedAIRunId(),null);
      completeAIRun(old.id,suggestions);
      assert.equal(status(old.id),"failed");
      assert.equal(nextQueuedAIRunId(),other.id);
      assert.ok(claimAIRun(other.id));
      completeAIRun(other.id,suggestions);
      assert.ok(claimAIRun(latest.id));
      completeAIRun(latest.id,suggestions);
      assert.equal(getAIState(first.id).run!.status,"ready");
      assert.equal(getAIState(first.id).run!.photoId,getTote(first.id).tote.photo!.id);
    });
    await t.test("edits before processing refresh the acceptance snapshot; edits during processing discard the result", async () => {
      fresh("edits");
      const tote = createTote({name:"Manual items"});
      await upload(tote.id);
      const run = getAIState(tote.id).run!;
      const manual = addItems(tote.id,{items:[{name:"Manual item",quantity:1}]});
      const claimed = claimAIRun(run.id)!;
      assert.equal(claimed.contents_updated_at,manual.tote.contentsUpdatedAt);
      completeAIRun(run.id,suggestions);
      assert.equal(getAIState(tote.id).run!.stale,false);
      const next = createAIRun(tote.id,{photoId:manual.tote.photo!.id,contentsUpdatedAt:manual.tote.contentsUpdatedAt,force:true}).state.run!;
      assert.ok(claimAIRun(next.id));
      const during = addItems(tote.id,{items:[{name:"Another manual item",quantity:2}]});
      completeAIRun(next.id,suggestions);
      assert.equal(getAIState(tote.id).run!.status,"failed");
      assert.match(getAIState(tote.id).run!.error!,/contents changed/);
      assert.deepEqual(getTote(tote.id),during);
    });
    await t.test("archived waiting totes are skipped and expired active work cannot publish a late result", async () => {
      fresh("skip-expired");
      const first = createTote({name:"Archived"});
      const second = createTote({name:"Next"});
      const third = createTote({name:"Last"});
      await upload(first.id);
      const old = getAIState(first.id).run!;
      await upload(second.id);
      const next = getAIState(second.id).run!;
      await upload(third.id);
      const last = getAIState(third.id).run!;
      archiveTote(first.id);
      assert.equal(nextQueuedAIRunId(),next.id);
      assert.equal(status(old.id),"failed");
      assert.ok(claimAIRun(next.id));
      getDatabase().prepare("UPDATE ai_suggestion_runs SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z",next.id);
      assert.equal(nextQueuedAIRunId(),last.id);
      assert.ok(claimAIRun(last.id));
      completeAIRun(next.id,suggestions);
      assert.equal(status(next.id),"failed");
      assert.equal(status(last.id),"running");
      completeAIRun(last.id,suggestions);
    });
    await t.test("schema 2 migration preserves accepted reviews and enforces one queued job per tote and one active analysis", () => {
      fresh("migration");
      const tote = createTote({name:"Preserved review"});
      const photo = recordPhoto(tote.id,{id:randomUUID(),originalName:"photo.jpg",mimeType:"image/jpeg"});
      const run = createAIRun(tote.id,{photoId:photo.tote.photo!.id,contentsUpdatedAt:photo.tote.contentsUpdatedAt}).state.run!;
      assert.ok(claimAIRun(run.id));
      completeAIRun(run.id,suggestions);
      const ready = getAIState(tote.id).run!;
      acceptAISuggestions(tote.id,{runId:ready.id,items:[{suggestionId:ready.suggestions[0].id,name:"Reviewed tape",quantity:3}]});
      const before = getTote(tote.id);
      const saved = getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE id=?").get(run.id);
      closeDatabase();
      const legacy = new Database(path.join(process.env.INVENTORY_DATA_DIR!,"inventory.sqlite"));
      legacy.exec("ALTER TABLE ai_suggestion_runs DROP COLUMN dismissed_at; ALTER TABLE ai_suggestion_runs DROP COLUMN dismissed_ids_json");
      legacy.exec("DROP INDEX ai_single_active_job; DROP INDEX ai_single_queued_tote; DROP INDEX ai_queue_order_idx; CREATE UNIQUE INDEX ai_single_active_job ON ai_suggestion_runs((1)) WHERE status IN ('queued','running')");
      legacy.pragma("user_version = 2");
      legacy.close();
      assert.deepEqual(getTote(tote.id),before);
      assert.equal(getDatabase().pragma("user_version",{simple:true}),4);
      assert.deepEqual(getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE id=?").get(run.id),saved);
      const first = createAIRun(tote.id,{photoId:before.tote.photo!.id,contentsUpdatedAt:before.tote.contentsUpdatedAt,force:true}).state.run!;
      const otherTote = createTote({name:"Other"});
      const otherPhoto = recordPhoto(otherTote.id,{id:randomUUID(),originalName:"other.jpg",mimeType:"image/jpeg"});
      const second = createAIRun(otherTote.id,{photoId:otherPhoto.tote.photo!.id,contentsUpdatedAt:otherPhoto.tote.contentsUpdatedAt}).state.run!;
      assert.throws(()=>getDatabase().prepare("UPDATE ai_suggestion_runs SET tote_id=? WHERE id=?").run(tote.id,second.id),/UNIQUE/);
      assert.ok(claimAIRun(first.id));
      assert.throws(()=>getDatabase().prepare("UPDATE ai_suggestion_runs SET status='running' WHERE id=?").run(second.id),/UNIQUE/);
      assert.equal(status(second.id),"queued");
    });
    await t.test("two workers retain exclusivity when the active tote is permanently deleted", async () => {
      fresh("workers-delete-running");
      const first = createTote({ name: "Delete active tote" });
      await upload(first.id);
      const firstRun = getAIState(first.id).run!;
      const second = createTote({ name: "Wait for cleanup" });
      await upload(second.id);
      const secondRun = getAIState(second.id).run!;
      const directory = process.env.INVENTORY_DATA_DIR!;
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      let active = 0, peak = 0, calls = 0;
      const server = createServer(async (request, response) => {
        for await (const _ of request) { /* consume the bounded request */ }
        response.setHeader("Content-Type", "application/json");
        if (request.url !== "/api/chat") { response.end('{"done":true}'); return; }
        active++; peak = Math.max(peak, active); calls++;
        if (calls === 1) await waiting;
        response.end(JSON.stringify({ done: true, done_reason: "stop", message: { content: JSON.stringify(suggestions) } }));
        active--;
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const children: ChildProcess[] = [];
      const exits: Promise<unknown>[] = [];
      let errors = "";
      async function until(check: () => boolean) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if (check()) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error("Deleted-tote worker fixture timed out: " + errors);
      }
      try {
        for (let index = 0; index < 2; index++) {
          const child = spawn(process.execPath, [path.resolve(".next/ai-worker.cjs")], {
            env: { ...process.env, AI_URL: "http://127.0.0.1:" + address.port, AI_WORKER_HEARTBEAT_PATH: path.join(directory, "heartbeat-" + index) },
            stdio: ["ignore", "pipe", "pipe"],
          });
          child.stderr?.on("data", data => { errors += String(data); });
          child.stdout?.resume();
          children.push(child);
          exits.push(new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal }))));
        }
        await until(() => calls === 1);
        deleteTote(first.id);
        assert.equal(getDatabase().prepare("SELECT id FROM ai_suggestion_runs WHERE id=?").get(firstRun.id), undefined);
        assert.equal(nextQueuedAIRunId(), null);
        // Let the idle worker wake and inspect the queue while the deleted request is still active.
        await new Promise(resolve => setTimeout(resolve, 2300));
        assert.equal(calls, 1);
        assert.equal(status(secondRun.id), "queued");
        release();
        await until(() => getAIState(second.id).run!.status === "ready");
        assert.equal(calls, 2);
        assert.equal(peak, 1);
        assert.equal(getDatabase().prepare("SELECT id FROM totes WHERE id=?").get(first.id), undefined);
        assert.equal(nextQueuedAIRunId(), null);
      } finally {
        release();
        for (const child of children) child.kill("SIGTERM");
        await Promise.all(exits);
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
    await t.test("real worker processes share the queue, survive simultaneous startup, and continue after model failure", async () => {
      fresh("workers");
      const first = createTote({name:"Red"});
      await upload(first.id);
      const firstRun = getAIState(first.id).run!;
      const directory = process.env.INVENTORY_DATA_DIR!;
      closeDatabase();
      const legacy = new Database(path.join(directory,"inventory.sqlite"));
      legacy.exec("ALTER TABLE ai_suggestion_runs DROP COLUMN dismissed_at; ALTER TABLE ai_suggestion_runs DROP COLUMN dismissed_ids_json");
      legacy.exec("DROP INDEX ai_single_active_job; DROP INDEX ai_single_queued_tote; DROP INDEX ai_queue_order_idx; CREATE UNIQUE INDEX ai_single_active_job ON ai_suggestion_runs((1)) WHERE status IN ('queued','running')");
      legacy.pragma("user_version = 2");
      legacy.close();
      let active = 0, peak = 0;
      const order: number[] = [];
      const server = createServer(async (request,response)=>{
        let input = "";
        for await (const chunk of request) input += String(chunk);
        const body = JSON.parse(input);
        response.setHeader("Content-Type","application/json");
        if (request.url !== "/api/chat") { response.end('{"done":true}'); return; }
        active++; peak=Math.max(peak,active);
        const bytes=Buffer.from(body.messages[1].images[0],"base64");
        const channels=(await sharp(bytes).stats()).channels;
        const color=channels.reduce((best,current,index)=>current.mean>channels[best].mean?index:best,0);
        order.push(color);
        const ordinal=order.length;
        await new Promise(resolve=>setTimeout(resolve,500));
        if (ordinal===1) { response.statusCode=500; response.end('{"error":"intentional fixture failure"}'); }
        else response.end(JSON.stringify({done:true,done_reason:"stop",message:{content:JSON.stringify({items:[{name:color===1?"Green item":"Blue item",quantity:1,note:""}]})}}));
        active--;
      });
      await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
      const address=server.address();
      assert.ok(address && typeof address!=="string");
      const children:ChildProcess[]=[];
      const exits:Promise<unknown>[]=[];
      let errors="";
      async function until(check:()=>boolean|Promise<boolean>) {
        const deadline=Date.now()+15000;
        while (Date.now()<deadline) {
          if (await check()) return;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        throw new Error("Worker fixture timed out: "+errors);
      }
      try {
        for (let index=0;index<2;index++) {
          const child=spawn(process.execPath,[path.resolve(".next/ai-worker.cjs")],{
            env:{...process.env,AI_URL:"http://127.0.0.1:"+address.port,AI_WORKER_HEARTBEAT_PATH:path.join(directory,"heartbeat-"+index)},
            stdio:["ignore","pipe","pipe"],
          });
          child.stderr?.on("data",data=>{errors+=String(data);});
          child.stdout?.resume();
          children.push(child);
          exits.push(new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal}))));
        }
        await until(async()=>Promise.all([0,1].map(index=>stat(path.join(directory,"heartbeat-"+index)).then(()=>true,()=>false))).then(values=>values.every(Boolean)));
        assert.equal(getDatabase().pragma("user_version",{simple:true}),4);
        const second=createTote({name:"Green"});
        const green=await sharp({create:{width:80,height:60,channels:3,background:"#00ff00"}}).jpeg().toBuffer();
        await upload(second.id,green);
        const third=createTote({name:"Blue"});
        const blue=await sharp({create:{width:80,height:60,channels:3,background:"blue"}}).jpeg().toBuffer();
        await upload(third.id,blue);
        await until(()=>[first,second,third].every(tote=>["ready","failed"].includes(getAIState(tote.id).run!.status)));
        assert.deepEqual(order,[0,1,2]);
        assert.equal(peak,1);
        assert.equal(status(firstRun.id),"failed");
        assert.equal(getAIState(second.id).run!.suggestions[0].name,"Green item");
        assert.equal(getAIState(third.id).run!.suggestions[0].name,"Blue item");
        for (const tote of [first,second,third]) assert.equal(getTote(tote.id).items.length,0);
        assert.equal(nextQueuedAIRunId(),null);
      } finally {
        for (const child of children) child.kill("SIGTERM");
        await Promise.all(exits);
        await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      }
    });
  } finally {
    closeDatabase();
    await rm(root,{recursive:true,force:true});
    delete process.env.AI_URL;
  }
});
