import { formatAxTree, type AxNode } from "./ax.ts";
import { attach, send, wakeRenderer } from "./cdp.ts";
import {
  clickAt,
  currentPointer,
  dragFromTo,
  forgetPointer,
  insertText,
  moveMouse,
  typeText,
  wheelAt,
} from "./pointer.ts";
import {
  AUTO_SCROLL_ATTEMPTS,
  FILL_VERIFY_ATTEMPTS,
  FILL_VERIFY_INTERVAL_MS,
} from "./pointer-motion.ts";
import { isRef, lookupRef } from "./refs.ts";
import { groupTab } from "./tab-groups.ts";
import { parseOptions, selectNativeOptions } from "./select-option.ts";
import { requireUsableBox } from "./element-box.ts";

type ToolArgs = Record<string, unknown>;

const MAX_EVAL = 100_000;

function str(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function num(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(args: ToolArgs, key: string): boolean {
  return args[key] === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tabFrom(args: ToolArgs): Promise<chrome.tabs.Tab> {
  const tabId = num(args, "_tabId");
  if (tabId != null) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      /* fall through */
    }
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active?.id) throw new Error("no tab found — call navigate first");
  return active;
}

function urlsMatch(tabUrl: string, want: string): boolean {
  const normalize = (value: string) => value.replace(/\/$/, "").toLowerCase();
  if (normalize(tabUrl) === normalize(want)) return true;
  try {
    const a = new URL(tabUrl);
    const b = want.includes("://") ? new URL(want) : new URL(`https://${want}`);
    return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "") && a.pathname.startsWith(b.pathname);
  } catch {
    return tabUrl.includes(want);
  }
}

async function resolveObjectId(tabId: number, selector: string, tool: string): Promise<string> {
  if (isRef(selector)) {
    const ref = lookupRef(tabId, selector);
    if (!ref) throw new Error(`${tool}: unknown ref "${selector}". Run snapshot first.`);
    const resolved = await send<{ object?: { objectId?: string } }>(tabId, "DOM.resolveNode", {
      backendNodeId: ref.backendDOMNodeId,
    });
    if (!resolved.object?.objectId) throw new Error(`${tool}: could not resolve ${selector}`);
    return resolved.object.objectId;
  }
  const result = await send<{ result?: { objectId?: string } }>(tabId, "Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: false,
  });
  if (!result.result?.objectId) throw new Error(`${tool}: element not found: ${selector}`);
  return result.result.objectId;
}

async function callOn<T>(
  tabId: number,
  objectId: string,
  declaration: string,
  args: Array<{ value?: unknown; objectId?: string }> = [],
): Promise<T> {
  const result = await send<{
    result?: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(tabId, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: declaration,
    arguments: args,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "script error");
  }
  return result.result?.value as T;
}

function waitForLoad(tabId: number, url: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("navigate: page load timeout (30s)"));
    }, timeoutMs);
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && info.status === "complete" && tab.url && tab.url !== "about:blank") {
        done();
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete" && tab.url && tab.url !== "about:blank") {
        done();
        resolve();
      }
    });
    void url;
  });
}

const FILL_FN = `function(value) {
  const el = this;
  el.focus();
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let inserted = false;
    try { inserted = document.execCommand('insertText', false, value); } catch {}
    if (!inserted) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }
    return { success: true, tag: el.tagName, mode: 'contenteditable' };
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
  if (!proto) return { error: 'fill: element is not an input, textarea, or contenteditable' };
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true, tag: el.tagName, mode: 'value' };
}`;

export async function executeTool(name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case "navigate":
      return navigate(args);
    case "find_tab":
      return findTab(args);
    case "snapshot":
      return snapshot(args);
    case "click":
      return click(args);
    case "fill":
      return fill(args);
    case "select_option":
      return selectOption(args);
    case "scroll":
      return scroll(args);
    case "drag":
      return drag(args);
    case "type":
      return typeKeys(args);
    case "evaluate":
      return evaluate(args);
    case "cdp":
      return cdp(args);
    case "screenshot":
      return screenshot(args);
    case "list_tabs":
      return listTabs(args);
    case "close_tab":
      return closeTab(args);
    case "close_session":
      return closeSession(args);
    case "wait":
      return wait(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function navigate(args: ToolArgs) {
  const url = str(args, "url");
  if (!url) throw new Error("navigate: url is required");
  const session = str(args, "_session");
  const title = str(args, "group_title");
  const existingId = bool(args, "newTab") ? undefined : num(args, "_tabId");
  let tab: chrome.tabs.Tab | undefined;
  if (existingId != null) {
    try {
      tab = await chrome.tabs.get(existingId);
    } catch {
      tab = undefined;
    }
  }
  if (!tab?.id || tab.url?.startsWith("chrome:") || tab.url?.startsWith("edge:")) {
    tab = await chrome.tabs.create({ url, active: false });
    if (!tab.id) throw new Error("navigate: failed to create tab");
    await groupTab(tab.id, session, title);
    await waitForLoad(tab.id, url);
    await attach(tab.id);
    await wakeRenderer(tab.id);
    forgetPointer(tab.id);
    return { success: true, url, tabId: tab.id };
  }
  await attach(tab.id);
  forgetPointer(tab.id);
  if (tab.url === url || tab.url === `${url}/`) {
    await send(tab.id, "Page.reload", { ignoreCache: true });
  } else {
    await send(tab.id, "Page.navigate", { url });
  }
  await waitForLoad(tab.id, url);
  await wakeRenderer(tab.id);
  return { success: true, url, tabId: tab.id };
}

async function findTab(args: ToolArgs) {
  const url = str(args, "url");
  if (!url) throw new Error("find_tab: url is required");
  if (bool(args, "active")) {
    const window = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal", "popup"] });
    const tab = window.tabs?.find((candidate) => candidate.active && candidate.url && urlsMatch(candidate.url, url));
    if (!tab?.id) throw new Error(`find_tab(active:true): no foreground tab matching ${url}`);
    await attach(tab.id);
    return { success: true, url: tab.url ?? url, tabId: tab.id, borrowed: true };
  }
  const ids = Array.isArray(args._tabIds) ? (args._tabIds as number[]) : [];
  for (const id of ids) {
    try {
      const tab = await chrome.tabs.get(id);
      if (tab.url && urlsMatch(tab.url, url)) {
        await attach(id);
        return { success: true, url: tab.url, tabId: id, borrowed: false };
      }
    } catch {
      continue;
    }
  }
  throw new Error(`find_tab: no tab matching ${url} in this session`);
}

async function snapshot(args: ToolArgs) {
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("snapshot: no tab");
  await attach(tab.id);
  const result = await send<{ nodes?: AxNode[] }>(tab.id, "Accessibility.getFullAXTree");
  const { tree, truncated } = formatAxTree(tab.id, result.nodes ?? []);
  return {
    url: tab.url,
    title: tab.title,
    tree,
    ...(truncated
      ? { truncated: true, note: "Output truncated. Re-run snapshot after focusing a smaller region." }
      : {}),
  };
}

type BoxInfo = {
  x: number;
  y: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  viewW: number;
  viewH: number;
  fullyVisible: boolean;
  tag: string;
  text: string;
};

const BOX_FN = `function() {
  const r = this.getBoundingClientRect();
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const width = r.width;
  const height = r.height;
  const fullyVisible =
    r.top >= 0 && r.left >= 0 && r.bottom <= viewH && r.right <= viewW && width > 0 && height > 0;
  return {
    x: r.left + width / 2,
    y: r.top + height / 2,
    top: r.top,
    left: r.left,
    bottom: r.bottom,
    right: r.right,
    width,
    height,
    viewW,
    viewH,
    fullyVisible,
    tag: this.tagName,
    text: (this.textContent || '').trim().slice(0, 100),
  };
}`;

async function readBox(tabId: number, objectId: string, tool: string): Promise<BoxInfo> {
  const info = await callOn<BoxInfo>(tabId, objectId, BOX_FN);
  if (info?.x == null || info?.y == null) throw new Error(`${tool}: element has no layout box`);
  requireUsableBox(info, tool);
  return info;
}

async function reveal(tabId: number, objectId: string, tool: string): Promise<BoxInfo> {
  for (let attempt = 0; attempt < AUTO_SCROLL_ATTEMPTS; attempt++) {
    const info = await readBox(tabId, objectId, tool);
    if (info.fullyVisible) return info;
    const dx = info.x - info.viewW / 2;
    const dy = info.y - info.viewH / 2;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return info;
    const wx = Math.min(Math.max(info.x, 8), Math.max(8, info.viewW - 8));
    const wy = Math.min(Math.max(info.y, 8), Math.max(8, info.viewH - 8));
    await wheelAt(tabId, { x: wx, y: wy }, dx, dy);
  }
  await callOn(tabId, objectId, `function() {
    this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  }`);
  return readBox(tabId, objectId, tool);
}

async function targetPoint(
  tabId: number,
  objectId: string,
  tool: string,
): Promise<{ x: number; y: number; tag: string; text: string }> {
  const info = await reveal(tabId, objectId, tool);
  return { x: info.x, y: info.y, tag: info.tag, text: info.text };
}

async function click(args: ToolArgs) {
  const selector = str(args, "selector");
  if (!selector) throw new Error("click: selector is required (@e ref or CSS)");
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("click: no tab");
  await attach(tab.id);
  const objectId = await resolveObjectId(tab.id, selector, "click");
  const info = await targetPoint(tab.id, objectId, "click");
  await clickAt(tab.id, { x: info.x, y: info.y });
  return { success: true, dispatched: true, tag: info.tag, text: info.text };
}

async function selectOption(args: ToolArgs) {
  const selector = str(args, "selector");
  if (!selector) throw new Error("select_option: selector is required (@e ref or CSS)");
  const options = parseOptions(args.option);
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("select_option: no tab");
  const objectId = await resolveObjectId(tab.id, selector, "select_option");
  return callOn(tab.id, objectId, selectNativeOptions.toString(), [{ value: options }]);
}

const SELECT_FN = `function() {
  this.focus();
  if (typeof this.select === 'function') this.select();
  else if (this.isContentEditable) {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(this);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  return true;
}`;

const VERIFY_FN = `function(expected) {
  const actual = this.isContentEditable
    ? String(this.textContent ?? '')
    : String(this.value ?? '');
  return { actual, ok: actual === expected, tag: this.tagName };
}`;

async function fill(args: ToolArgs) {
  const selector = str(args, "selector");
  const value = args.value;
  if (!selector) throw new Error("fill: selector is required");
  if (value == null) throw new Error("fill: value is required");
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("fill: no tab");
  await attach(tab.id);
  const objectId = await resolveObjectId(tab.id, selector, "fill");
  const point = await targetPoint(tab.id, objectId, "fill");
  await clickAt(tab.id, { x: point.x, y: point.y });
  const text = String(value);
  await callOn(tab.id, objectId, SELECT_FN);
  await insertText(tab.id, text);
  for (let i = 0; i < FILL_VERIFY_ATTEMPTS; i++) {
    const check = await callOn<{ actual?: string; ok?: boolean; tag?: string }>(
      tab.id,
      objectId,
      VERIFY_FN,
      [{ value: text }],
    );
    if (check?.ok) {
      return { success: true, tag: check.tag ?? point.tag, mode: "insertText" };
    }
    if (i < FILL_VERIFY_ATTEMPTS - 1) await sleep(FILL_VERIFY_INTERVAL_MS);
  }
  const result = await callOn<{ success?: boolean; tag?: string; mode?: string; error?: string }>(
    tab.id,
    objectId,
    FILL_FN,
    [{ value: text }],
  );
  if (result?.error) throw new Error(result.error);
  return result ?? { success: true, mode: "value" };
}

async function scroll(args: ToolArgs) {
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("scroll: no tab");
  await attach(tab.id);
  const selector = str(args, "selector");
  const deltaX = num(args, "deltaX") ?? 0;
  const deltaY = num(args, "deltaY") ?? 0;
  if (selector && deltaX === 0 && deltaY === 0) {
    const objectId = await resolveObjectId(tab.id, selector, "scroll");
    const info = await reveal(tab.id, objectId, "scroll");
    return { success: true, intoView: true, tag: info.tag, x: info.x, y: info.y };
  }
  if (deltaX === 0 && deltaY === 0) {
    throw new Error("scroll: deltaX, deltaY, or selector is required");
  }
  let point;
  if (selector) {
    const objectId = await resolveObjectId(tab.id, selector, "scroll");
    const info = await reveal(tab.id, objectId, "scroll");
    point = { x: info.x, y: info.y };
    await moveMouse(tab.id, point);
  } else {
    point = await currentPointer(tab.id);
  }
  await wheelAt(tab.id, point, deltaX, deltaY);
  return { success: true, deltaX, deltaY, x: point.x, y: point.y };
}

async function drag(args: ToolArgs) {
  const fromSel = str(args, "from");
  const toSel = str(args, "to");
  if (!fromSel || !toSel) throw new Error('drag: both "from" and "to" are required (@e ref or CSS)');
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("drag: no tab");
  await attach(tab.id);
  const fromId = await resolveObjectId(tab.id, fromSel, "drag");
  const toId = await resolveObjectId(tab.id, toSel, "drag");
  await reveal(tab.id, fromId, "drag");
  const toBox = await reveal(tab.id, toId, "drag");
  const fromBox = await readBox(tab.id, fromId, "drag");
  const moved = await dragFromTo(
    tab.id,
    { x: fromBox.x, y: fromBox.y },
    { x: toBox.x, y: toBox.y },
  );
  return {
    success: true,
    from: { tag: fromBox.tag, text: fromBox.text, x: moved.from.x, y: moved.from.y },
    to: { tag: toBox.tag, text: toBox.text, x: moved.to.x, y: moved.to.y },
  };
}

async function typeKeys(args: ToolArgs) {
  const text = args.text == null ? undefined : String(args.text);
  if (text == null) throw new Error("type: text is required");
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("type: no tab");
  await attach(tab.id);
  const selector = str(args, "selector");
  if (selector) {
    const objectId = await resolveObjectId(tab.id, selector, "type");
    const point = await targetPoint(tab.id, objectId, "type");
    await clickAt(tab.id, { x: point.x, y: point.y });
  }
  const delayMs = num(args, "delayMs");
  await typeText(tab.id, text, delayMs);
  return { success: true, chars: [...text].length };
}

async function evaluate(args: ToolArgs) {
  const code = str(args, "code");
  if (!code) throw new Error("evaluate: code is required");
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("evaluate: no tab");
  await attach(tab.id);
  const result = await send<{
    result?: { type?: string; value?: unknown; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(tab.id, "Runtime.evaluate", {
    expression: code,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "evaluate failed");
  }
  const value = result.result?.value;
  const serialized = JSON.stringify(value);
  if (serialized && serialized.length > MAX_EVAL) {
    return {
      type: "string",
      value: serialized.slice(0, MAX_EVAL),
      truncated: true,
      totalChars: serialized.length,
      note: "Result truncated. Return counts/slices instead of raw text.",
    };
  }
  return { type: result.result?.type ?? typeof value, value };
}

async function cdp(args: ToolArgs) {
  const method = str(args, "method");
  if (!method) throw new Error("cdp: method is required");
  if (method === "Target.activateTarget") {
    throw new Error("cdp: Target.activateTarget is refused — it steals the user's focus.");
  }
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("cdp: no tab");
  await attach(tab.id);
  const params =
    args.params && typeof args.params === "object" && !Array.isArray(args.params)
      ? (args.params as Record<string, unknown>)
      : {};
  const result = await send(tab.id, method, params);
  return result ?? {};
}

async function screenshot(args: ToolArgs) {
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("screenshot: no tab");
  await attach(tab.id);
  const format = str(args, "format") === "jpeg" ? "jpeg" : "png";
  const quality = format === "jpeg" ? (num(args, "quality") ?? 80) : undefined;
  const selector = str(args, "selector");
  const params: Record<string, unknown> = { format };
  if (quality != null) params.quality = quality;
  if (selector) {
    const objectId = await resolveObjectId(tab.id, selector, "screenshot");
    await callOn(tab.id, objectId, `function() { this.scrollIntoView({ block: 'center', inline: 'center' }); }`);
    const box = await send<{ model?: { border?: number[] } }>(tab.id, "DOM.getBoxModel", { objectId });
    const border = box.model?.border;
    if (!border || border.length < 8) throw new Error("screenshot: element has no layout box");
    const xs = [border[0]!, border[2]!, border[4]!, border[6]!];
    const ys = [border[1]!, border[3]!, border[5]!, border[7]!];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (width <= 0 || height <= 0) throw new Error("screenshot: zero-size box");
    params.clip = { x, y, width, height, scale: 1 };
  }
  const captured = await send<{ data?: string }>(tab.id, "Page.captureScreenshot", params);
  if (!captured.data) throw new Error("screenshot: empty capture");
  return {
    format,
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    base64: captured.data,
  };
}

async function listTabs(args: ToolArgs) {
  const ids = Array.isArray(args._tabIds) ? (args._tabIds as number[]) : [];
  const owned = new Set(Array.isArray(args._ownedTabIds) ? (args._ownedTabIds as number[]) : []);
  const tabs = [];
  for (const id of ids) {
    try {
      const tab = await chrome.tabs.get(id);
      let groupTitle: string | undefined;
      if (tab.groupId != null && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        try {
          groupTitle = (await chrome.tabGroups.get(tab.groupId)).title;
        } catch {
          /* ignore */
        }
      }
      tabs.push({
        tabId: tab.id,
        url: tab.url ?? "",
        title: tab.title ?? "",
        active: tab.active,
        groupTitle,
        borrowed: !owned.has(id),
      });
    } catch {
      continue;
    }
  }
  return { success: true, tabs };
}

async function closeTab(args: ToolArgs) {
  const tab = await tabFrom(args);
  if (!tab.id) return { success: true, closed: false };
  await chrome.tabs.remove(tab.id);
  return { success: true, closed: true };
}

async function closeSession(args: ToolArgs) {
  const owned = Array.isArray(args._ownedTabIds) ? (args._ownedTabIds as number[]) : [];
  let closed = 0;
  for (const id of owned) {
    try {
      await chrome.tabs.remove(id);
      closed += 1;
    } catch {
      /* already gone */
    }
  }
  return { success: true, closed };
}

async function wait(args: ToolArgs) {
  const tab = await tabFrom(args);
  if (!tab.id) throw new Error("wait: no tab");
  await attach(tab.id);
  const timeoutMs = Math.min(Math.max(num(args, "timeoutMs") ?? 10_000, 500), 60_000);
  const text = str(args, "text");
  const selector = str(args, "selector");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await send<{ result?: { value?: { matched?: string } | null } }>(tab.id, "Runtime.evaluate", {
      expression: `(() => {
        ${text ? `if (document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})) return { matched: 'text' };` : ""}
        ${selector ? `if (document.querySelector(${JSON.stringify(selector)})) return { matched: 'selector' };` : ""}
        return null;
      })()`,
      returnByValue: true,
    });
    if (result.result?.value?.matched) {
      return { success: true, matched: result.result.value.matched, waitedMs: Date.now() - started };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`wait: timed out after ${timeoutMs}ms`);
}
