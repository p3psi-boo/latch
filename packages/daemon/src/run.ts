import vm from "node:vm";
import { dispatchCommand } from "./dispatch.ts";
import type { Hub } from "./hub.ts";

export const DEFAULT_RUN_TIMEOUT_MS = 60_000;
const MAX_RUN_TIMEOUT_MS = 5 * 60 * 1000;

export type DispatchFn = (action: string, args: Record<string, unknown>) => Promise<unknown>;

export type RunInput = {
  source: string;
  dispatch: DispatchFn;
  timeoutMs?: number;
};

export type RunOutput =
  | { ok: true; logs: unknown[]; result: unknown }
  | { ok: false; logs: unknown[]; error: string; step?: string };

export function parseTimeoutMs(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_RUN_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_RUN_TIMEOUT_MS, Math.floor(raw)));
}

function cloneValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function extraArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function bindPage(dispatch: DispatchFn) {
  const call = (action: string, args: Record<string, unknown> = {}) => dispatch(action, args);
  return {
    snapshot: (opts?: unknown) => call("snapshot", extraArgs(opts)),
    click: (selector: unknown, opts?: unknown) =>
      call("click", { ...extraArgs(opts), selector }),
    fill: (selector: unknown, value: unknown, opts?: unknown) =>
      call("fill", { ...extraArgs(opts), selector, value }),
    scroll: (opts?: unknown) => call("scroll", extraArgs(opts)),
    drag: (from: unknown, to: unknown, opts?: unknown) =>
      call("drag", { ...extraArgs(opts), from, to }),
    type: (text: unknown, opts?: unknown) => call("type", { ...extraArgs(opts), text }),
    wait: (opts?: unknown) => call("wait", extraArgs(opts)),
    goto: (url: unknown, opts?: unknown) => call("navigate", { ...extraArgs(opts), url }),
    screenshot: (opts?: unknown) => call("screenshot", extraArgs(opts)),
    evaluate: (code: unknown, opts?: unknown) => call("evaluate", { ...extraArgs(opts), code }),
    cdp: (method: unknown, params?: unknown) => call("cdp", { method, params }),
    findTab: (opts?: unknown) => call("find_tab", extraArgs(opts)),
    listTabs: (opts?: unknown) => call("list_tabs", extraArgs(opts)),
    closeTab: (opts?: unknown) => call("close_tab", extraArgs(opts)),
    closeSession: (opts?: unknown) => call("close_session", extraArgs(opts)),
  };
}

export async function executeRun(input: RunInput): Promise<RunOutput> {
  const source = input.source;
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, logs: [], error: "source is required" };
  }
  const logs: unknown[] = [];
  let step: string | undefined;
  const dispatch: DispatchFn = async (action, args) => {
    step = action;
    return input.dispatch(action, args);
  };
  const page = bindPage(dispatch);
  const cliLog = (...args: unknown[]) => {
    logs.push(args.length <= 1 ? cloneValue(args[0]) : args.map(cloneValue));
  };
  const sandbox: Record<string, unknown> = {
    page,
    task: { page: (_label?: unknown) => page },
    cliLog,
    console: { log: cliLog, info: cliLog, warn: cliLog, error: cliLog },
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    Map,
    Set,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
  };
  Object.freeze(page);
  Object.freeze(sandbox.task);
  Object.freeze(sandbox.console);
  const context = vm.createContext(sandbox, {
    name: "latch-run",
    codeGeneration: { strings: false, wasm: false },
  });
  const wrapped = `"use strict";\n(async () => {\n${source}\n})()`;
  const timeoutMs = parseTimeoutMs(input.timeoutMs);
  try {
    const script = new vm.Script(wrapped, { filename: "latch-run.js" });
    const pending = script.runInContext(context, {
      timeout: timeoutMs,
      importModuleDynamically: async () => {
        throw new Error("import is not allowed in latch run");
      },
    } as vm.RunningScriptOptions);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve(pending),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`run timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return { ok: true, logs, result: cloneValue(result) ?? null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return step ? { ok: false, logs, error: message, step } : { ok: false, logs, error: message };
  }
}

export function bindHubDispatch(hub: Hub, session: string, browser?: string): DispatchFn {
  return async (action, args) => {
    const slot = hub.resolve(browser);
    return dispatchCommand(slot.bridge, slot.store, action, args, session);
  };
}
