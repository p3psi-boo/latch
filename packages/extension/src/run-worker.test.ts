import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installRunWorker } from "./run-worker.ts";

async function run(source: string, dispatch: (name: string, args: Record<string, unknown>) => Promise<unknown> = async () => ({})) {
  let finish!: (outcome: any) => void;
  const complete = new Promise<any>((resolve) => { finish = resolve; });
  const context = vm.createContext({ postMessage: (message: any) => {
    if (message.type === "done") finish(JSON.parse(JSON.stringify(message.outcome)));
    if (message.type === "call") {
      void dispatch(message.name, JSON.parse(JSON.stringify(message.args))).then(
        (data) => context.onmessage({ data: { type: "reply", id: message.id, data } }),
        (error) => context.onmessage({ data: { type: "reply", id: message.id, error: String(error) } }),
      );
    }
  } });
  vm.runInContext(`(${installRunWorker.toString()})();`, context);
  context.onmessage({ data: { type: "start", source } });
  return await complete;
}

test("plugin worker captures logs and return values without host globals", async () => {
  const result = await run('cliLog("hello"); return {n:7,chrome:typeof chrome,process:typeof process};');
  assert.deepEqual(result, { ok: true, logs: ["hello"], result: { n: 7, chrome: "undefined", process: "undefined" } });
});

test("plugin worker generic call accepts newly added tools and stops on errors", async () => {
  const calls: string[] = [];
  const result = await run('cliLog(await page.call("extension_added", {payload:"test"})); await page.click("@e1"); await page.fill("@e2","must not run");', async (name, args) => {
    calls.push(name);
    if (name === "click") throw new Error("element gone");
    assert.deepEqual(args, { payload: "test" });
    return "plugin response";
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "click");
  assert.match(result.error, /element gone/);
  assert.deepEqual(result.logs, ["plugin response"]);
  assert.deepEqual(calls, ["extension_added", "click"]);
});

test("plugin worker preserves page helpers and task.page alias", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const result = await run('const p=task.page("p1"); await p.goto("https://example.com",{newTab:true}); await p.selectOption("select",{label:"Two"}); return "ok";', async (name, args) => { calls.push({ name, args }); return {}; });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ name: "navigate", args: { url: "https://example.com", newTab: true } }, { name: "select_option", args: { selector: "select", option: { label: "Two" } } }]);
});

test("plugin worker has no require function", async () => {
  const result = await run('require("fs").writeFileSync("host-file","unexpected");');
  assert.equal(result.ok, false);
  assert.match(result.error, /require is not defined/);
});
