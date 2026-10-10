import assert from "node:assert/strict";
import test from "node:test";
import { applyToolSideEffects, SessionStore } from "./sessions.ts";

test("injects current tab and session onto args", () => {
  const store = new SessionStore();
  store.bind("research", 12, true);
  const args = store.inject("research", { url: "https://example.com" });
  assert.equal(args._session, "research");
  assert.equal(args._tabId, 12);
  assert.deepEqual(args._ownedTabIds, [12]);
});

test("borrowed find_tab does not mark ownership", () => {
  const store = new SessionStore();
  applyToolSideEffects(store, "s", "find_tab", {}, { tabId: 7, borrowed: true });
  const session = store.get("s");
  assert.deepEqual(session.ownedTabIds, []);
  assert.deepEqual(session.tabIds, [7]);
  assert.equal(session.currentTabId, 7);
});

test("close_session drops the record", () => {
  const store = new SessionStore();
  store.bind("s", 1, true);
  applyToolSideEffects(store, "s", "close_session", {}, { closed: 1 });
  assert.deepEqual(store.get("s").tabIds, []);
});

test("plugin session state restores current and borrowed tabs after worker restart", () => {
  const first = new SessionStore();
  first.bind("s", 1, true);
  first.bind("s", 2, false);
  const restored = new SessionStore();
  restored.restore(JSON.parse(JSON.stringify(first.dump())));
  assert.deepEqual(restored.get("s"), first.get("s"));
  restored.forgetTab(2);
  assert.equal(restored.get("s").currentTabId, 1);
  assert.deepEqual(restored.get("s").ownedTabIds, [1]);
});
