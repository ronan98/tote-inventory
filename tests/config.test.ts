import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AI_MODEL, resolveAIModel, resolveAppOrigin } from "../src/lib/config";

test("production requires an explicit QR and browser origin", () => {
  assert.throws(() => resolveAppOrigin({ NODE_ENV: "production" }), /Set APP_ORIGIN/);
  assert.throws(() => resolveAppOrigin({ NODE_ENV: "production", APP_ORIGIN: "  " }), /Set APP_ORIGIN/);
  assert.equal(resolveAppOrigin({ NODE_ENV: "development" }), "http://localhost:3000");
});

test("origins preserve LAN ports and normalize a root slash", () => {
  assert.equal(resolveAppOrigin({ APP_ORIGIN: " http://192.168.1.50:8080/ " }), "http://192.168.1.50:8080");
  assert.equal(resolveAppOrigin({ APP_ORIGIN: "https://INVENTORY.example.test:443/" }), "https://inventory.example.test");
  assert.equal(resolveAppOrigin({ APP_ORIGIN: "http://[::1]:8080" }), "http://[::1]:8080");
});

test("invalid origins cannot create misleading labels or mutation settings", () => {
  for (const APP_ORIGIN of ["inventory.example.test", "ftp://inventory.example.test", "https://user:pass@inventory.example.test", "https://inventory.example.test/totes", "https://inventory.example.test/?x=1", "https://inventory.example.test/#totes"]) {
    assert.throws(() => resolveAppOrigin({ APP_ORIGIN }), /APP_ORIGIN/);
  }
});

test("AI model can be selected independently of the built image", () => {
  assert.equal(resolveAIModel({}), DEFAULT_AI_MODEL);
  assert.equal(resolveAIModel({ AI_MODEL: "  " }), DEFAULT_AI_MODEL);
  assert.equal(resolveAIModel({ AI_MODEL: " another-vision-model:small " }), "another-vision-model:small");
});
