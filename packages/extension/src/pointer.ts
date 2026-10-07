import { send, wakeRenderer } from "./cdp.ts";
import {
  INPUT_EVENT_DELAY_MS,
  path,
  type Point,
  wheelDeltas,
  WHEEL_STEP_INTERVAL_MS,
} from "./pointer-motion.ts";

const lastByTab = new Map<number, Point>();
const FRAME_MS = 1000 / 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mouseEvent(
  tabId: number,
  type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel",
  point: Point,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await send(tabId, "Input.dispatchMouseEvent", {
    type,
    x: point.x,
    y: point.y,
    ...extra,
  });
  lastByTab.set(tabId, point);
}

async function origin(tabId: number): Promise<Point> {
  const stored = lastByTab.get(tabId);
  if (stored) return stored;
  const metrics = await send<{
    cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
    cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
  }>(tabId, "Page.getLayoutMetrics");
  const view = metrics.cssVisualViewport ?? metrics.cssLayoutViewport;
  return {
    x: (view?.clientWidth ?? 800) * 0.35,
    y: (view?.clientHeight ?? 600) * 0.4,
  };
}

export async function currentPointer(tabId: number): Promise<Point> {
  return origin(tabId);
}

/** Move the page's real mouse along ego-lite timing. Sites see mousemove. */
export async function moveMouse(
  tabId: number,
  target: Point,
  extra: Record<string, unknown> = {},
): Promise<Point> {
  const start = await origin(tabId);
  const samples = path(start, target);
  const payload = { button: "none", buttons: 0, ...extra };
  for (let i = 0; i < samples.length; i++) {
    const point = samples[i]!;
    await mouseEvent(tabId, "mouseMoved", point, payload);
    if (i < samples.length - 1) await sleep(FRAME_MS);
  }
  return samples.at(-1) ?? target;
}

export async function clickAt(tabId: number, target: Point): Promise<Point> {
  const point = await moveMouse(tabId, target);
  await sleep(INPUT_EVENT_DELAY_MS);
  await mouseEvent(tabId, "mousePressed", point, {
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await sleep(INPUT_EVENT_DELAY_MS);
  await mouseEvent(tabId, "mouseReleased", point, {
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  return point;
}

export async function wheelAt(
  tabId: number,
  point: Point,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  if (deltaX === 0 && deltaY === 0) return;
  await wakeRenderer(tabId);
  const frames = wheelDeltas(deltaX, deltaY);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    await mouseEvent(tabId, "mouseWheel", point, {
      pointerType: "mouse",
      deltaX: frame.dx,
      deltaY: frame.dy,
    });
    if (i < frames.length - 1) await sleep(WHEEL_STEP_INTERVAL_MS);
  }
}

export async function dragFromTo(
  tabId: number,
  src: Point,
  dst: Point,
): Promise<{ from: Point; to: Point }> {
  const from = await moveMouse(tabId, src);
  await sleep(INPUT_EVENT_DELAY_MS);
  await mouseEvent(tabId, "mousePressed", from, {
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await sleep(INPUT_EVENT_DELAY_MS);
  const to = await moveMouse(tabId, dst, { button: "left", buttons: 1 });
  await sleep(INPUT_EVENT_DELAY_MS);
  await mouseEvent(tabId, "mouseReleased", to, {
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  return { from, to };
}

export async function insertText(tabId: number, text: string): Promise<void> {
  await send(tabId, "Input.insertText", { text });
}

function keyPayload(ch: string): Record<string, unknown> {
  if (ch === "\n" || ch === "\r") {
    return { key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 };
  }
  if (ch === "\t") {
    return { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
  }
  return { key: ch, text: ch, unmodifiedText: ch };
}

export async function typeText(tabId: number, text: string, delayMs?: number): Promise<void> {
  const gap = delayMs != null && delayMs > 0 ? delayMs : 0;
  for (const ch of text) {
    const payload = keyPayload(ch);
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...payload });
    if (gap) await sleep(gap);
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: payload.key, code: payload.code });
  }
}

export function forgetPointer(tabId: number): void {
  lastByTab.delete(tabId);
}

if (typeof chrome !== "undefined" && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => lastByTab.delete(tabId));
}
