import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionBridge } from "./bridge.ts";
import { Hub } from "./hub.ts";

class OpenBridge extends ExtensionBridge {
  override get connected(): boolean {
    return true;
  }
}

class ClosedBridge extends ExtensionBridge {
  override get connected(): boolean {
    return false;
  }
}

test("claim same id replaces the bridge without keeping browser session state in daemon", () => {
  const hub = new Hub();
  hub.claim("work", "office", new OpenBridge());
  const incoming = new OpenBridge();
  const second = hub.claim("work", "laptop", incoming);
  assert.equal(second.bridge, incoming);
  assert.equal(second.remark, "laptop");
  assert.equal("store" in second, false);
  assert.equal(hub.size(), 1);
});

test("two ids are independent slots", () => {
  const hub = new Hub();
  hub.claim("work", "office", new OpenBridge());
  hub.claim("home", undefined, new OpenBridge());
  const listed = hub.list();
  assert.deepEqual(
    listed.map((item) => item.id).sort(),
    ["home", "work"],
  );
  assert.equal(listed.find((item) => item.id === "work")?.remark, "office");
});

test("resolve uses the only connected browser when id is omitted", () => {
  const hub = new Hub();
  hub.claim("work", "office", new OpenBridge());
  hub.claim("home", undefined, new ClosedBridge());
  assert.equal(hub.resolve().id, "work");
});

test("resolve requires an id when two browsers are connected", () => {
  const hub = new Hub();
  hub.claim("work", "office", new OpenBridge());
  hub.claim("home", "laptop", new OpenBridge());
  assert.throws(() => hub.resolve(), /multiple browsers connected/);
  assert.equal(hub.resolve("work").id, "work");
  assert.equal(hub.resolve("home").id, "home");
});

test("resolve errors on unknown or disconnected ids", () => {
  const hub = new Hub();
  hub.claim("work", undefined, new OpenBridge());
  hub.claim("home", undefined, new ClosedBridge());
  assert.throws(() => hub.resolve("nope"), /unknown browser/);
  assert.throws(() => hub.resolve("home"), /not connected/);
});
