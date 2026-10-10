export function installRunWorker() {
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (data: unknown) => void;
  };
  const requests = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  let next = 0;
  let step: string | undefined;
  const clone = (value: unknown) => { try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); } };
  const extra = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const call = (name: string, args: Record<string, unknown> = {}) => {
    step = name;
    return new Promise((resolve, reject) => {
      const id = ++next;
      requests.set(id, { resolve, reject });
      scope.postMessage({ type: "call", id, name, args });
    });
  };
  const page = Object.freeze({
    call,
    snapshot: (opts?: unknown) => call("snapshot", extra(opts)),
    click: (selector: unknown, opts?: unknown) => call("click", { ...extra(opts), selector }),
    fill: (selector: unknown, value: unknown, opts?: unknown) => call("fill", { ...extra(opts), selector, value }),
    selectOption: (selector: unknown, option: unknown, opts?: unknown) => call("select_option", { ...extra(opts), selector, option }),
    scroll: (opts?: unknown) => call("scroll", extra(opts)),
    drag: (from: unknown, to: unknown, opts?: unknown) => call("drag", { ...extra(opts), from, to }),
    type: (text: unknown, opts?: unknown) => call("type", { ...extra(opts), text }),
    wait: (opts?: unknown) => call("wait", extra(opts)),
    goto: (url: unknown, opts?: unknown) => call("navigate", { ...extra(opts), url }),
    screenshot: (opts?: unknown) => call("screenshot", extra(opts)),
    evaluate: (code: unknown, opts?: unknown) => call("evaluate", { ...extra(opts), code }),
    cdp: (method: unknown, params?: unknown) => call("cdp", { method, params }),
    findTab: (opts?: unknown) => call("find_tab", extra(opts)),
    listTabs: (opts?: unknown) => call("list_tabs", extra(opts)),
    closeTab: (opts?: unknown) => call("close_tab", extra(opts)),
    closeSession: (opts?: unknown) => call("close_session", extra(opts)),
  });
  scope.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "reply") {
      const request = requests.get(msg.id);
      requests.delete(msg.id);
      if (msg.error) request?.reject(new Error(msg.error)); else request?.resolve(msg.data);
      return;
    }
    if (msg.type !== "start") return;
    const logs: unknown[] = [];
    const cliLog = (...values: unknown[]) => {
      const value = values.length <= 1 ? clone(values[0]) : values.map(clone);
      logs.push(value); scope.postMessage({ type: "log", value });
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    void (async () => {
      try {
        const execute = new AsyncFunction("page", "task", "cliLog", "console", `"use strict";\n${msg.source}`);
        const result = await execute(page, Object.freeze({ page: () => page }), cliLog, Object.freeze({ log: cliLog, info: cliLog, warn: cliLog, error: cliLog }));
        scope.postMessage({ type: "done", outcome: { ok: true, logs, result: clone(result) ?? null } });
      } catch (error) {
        scope.postMessage({ type: "done", outcome: { ok: false, logs, error: error instanceof Error ? error.message : String(error), ...(step ? { step } : {}) } });
      }
    })();
  };
}
