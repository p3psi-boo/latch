import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeWireMessage,
  mintBrowserId,
  normalizeRemark,
  parseBrowserId,
  parseWireMessage,
  PROTOCOL_VERSION,
} from "./index.ts";

test("wire hello round-trips with browser id and remark", () => {
  const raw = encodeWireMessage({
    type: "hello",
    payload: {
      tools: [{ name: "extension_added_tool", inputSchema: { type: "object" } }],
      extensionVersion: "0.1.0",
      protocolVersion: PROTOCOL_VERSION,
      browserId: "work",
      remark: "office Chrome",
    },
  });
  const parsed = parseWireMessage(raw);
  assert.equal(parsed.type, "hello");
  if (parsed.type === "hello") {
    assert.equal(parsed.payload.extensionVersion, "0.1.0");
    assert.equal(parsed.payload.browserId, "work");
    assert.equal(parsed.payload.remark, "office Chrome");
  }
});

test("parseBrowserId rejects empty and junk", () => {
  assert.equal(parseBrowserId(undefined).ok, false);
  assert.equal(parseBrowserId("  ").ok, false);
  assert.deepEqual(parseBrowserId("work"), { ok: true, id: "work" });
  assert.deepEqual(parseBrowserId("  公司电脑  "), { ok: true, id: "公司电脑" });
  assert.equal(parseBrowserId("x".repeat(65)).ok, false);
  assert.equal(parseBrowserId(1).ok, false);
});

test("mintBrowserId returns a UUID v4", () => {
  const id = mintBrowserId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(mintBrowserId(), id);
});

test("normalizeRemark trims and caps", () => {
  assert.equal(normalizeRemark("  office  "), "office");
  assert.equal(normalizeRemark(""), undefined);
  assert.equal(normalizeRemark("a".repeat(250))?.length, 200);
});

test("parseWireMessage rejects garbage", () => {
  assert.throws(() => parseWireMessage("{}"));
  assert.throws(() => parseWireMessage("[]"));
});
