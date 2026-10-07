import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeRun, type DispatchFn } from "./run.ts";

test("multi-step script logs, calls helpers in order, and stops on error", async () => {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const dispatch: DispatchFn = async (action, args) => {
    calls.push({ action, args });
    if (action === "click") throw new Error("element gone");
    if (action === "snapshot") return { tree: "button Submit @e1" };
    return { ok: true };
  };
  const out = await executeRun({
    dispatch,
    source: `
      cliLog("start");
      const snap = await page.snapshot();
      cliLog(snap.tree);
      await page.click("@e1");
      await page.fill("@e2", "nope");
      cliLog("should not run");
    `,
  });
  assert.equal(out.ok, false);
  if (out.ok) throw new Error("expected failure");
  assert.equal(out.step, "click");
  assert.match(out.error, /element gone/);
  assert.deepEqual(out.logs, ["start", "button Submit @e1"]);
  assert.deepEqual(
    calls.map((item) => item.action),
    ["snapshot", "click"],
  );
  assert.equal(calls[1]?.args.selector, "@e1");
});

test("cliLog and return value are captured", async () => {
  const out = await executeRun({
    dispatch: async () => {
      throw new Error("dispatch should not run");
    },
    source: `
      cliLog("hello-run");
      return { n: 7 };
    `,
  });
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error("expected success");
  assert.deepEqual(out.logs, ["hello-run"]);
  assert.deepEqual(out.result, { n: 7 });
});

test("scroll, drag, and type helpers dispatch the matching tools", async () => {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const out = await executeRun({
    dispatch: async (action, args) => {
      calls.push({ action, args });
      return { ok: true };
    },
    source: `
      await page.scroll({ deltaY: 800 });
      await page.drag("@e1", "@e2");
      await page.type("hi", { selector: "@e3", delayMs: 10 });
      return "ok";
    `,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(
    calls.map((item) => item.action),
    ["scroll", "drag", "type"],
  );
  assert.equal(calls[0]?.args.deltaY, 800);
  assert.equal(calls[1]?.args.from, "@e1");
  assert.equal(calls[1]?.args.to, "@e2");
  assert.equal(calls[2]?.args.text, "hi");
  assert.equal(calls[2]?.args.selector, "@e3");
  assert.equal(calls[2]?.args.delayMs, 10);
});

test("task.page is an alias for the session page", async () => {
  const actions: string[] = [];
  const out = await executeRun({
    dispatch: async (action) => {
      actions.push(action);
      return { ok: true };
    },
    source: `
      const p = task.page("p1");
      await p.goto("https://example.com", { newTab: true });
      return "ok";
    `,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(actions, ["navigate"]);
});

test("require(fs) is denied and writes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "latch-run-"));
  const target = join(dir, "pwned.txt");
  await writeFile(target, "safe");
  const out = await executeRun({
    dispatch: async () => ({ ok: true }),
    source: `
      cliLog("before-fs");
      require("fs").writeFileSync(${JSON.stringify(target)}, "pwned");
    `,
  });
  assert.equal(out.ok, false);
  if (out.ok) throw new Error("expected failure");
  assert.match(out.error, /require is not defined|not allowed|is not defined/i);
  assert.deepEqual(out.logs, ["before-fs"]);
  assert.equal(await readFile(target, "utf8"), "safe");
});
