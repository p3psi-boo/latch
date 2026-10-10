export const DEFAULT_RUN_TIMEOUT_MS = 60_000;
const MAX_RUN_TIMEOUT_MS = 5 * 60 * 1000; // Preserves the existing run contract.
export function parseTimeoutMs(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_RUN_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_RUN_TIMEOUT_MS, Math.floor(raw)));
}
type Dispatch = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const pending = new Map<string, Dispatch>();
let creating: Promise<void> | undefined;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (contexts.length) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING, chrome.offscreen.Reason.WORKERS], justification: "Execute automation scripts in isolated sandbox workers and relay browser actions." }).finally(() => { creating = undefined; });
  await creating;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "latch-run-background") return;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("offscreen.html")) return;
  const dispatch = pending.get(message.runId);
  if (!dispatch) { sendResponse({ error: "run has ended" }); return; }
  if (message.name === "run") { sendResponse({ error: "Nested run is not supported" }); return; }
  void dispatch(String(message.name), message.args ?? {}).then((data) => sendResponse({ data }), (error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});
export async function executeRun(args: Record<string, unknown>, dispatch: Dispatch): Promise<unknown> {
  if (typeof args.source !== "string" || !args.source.trim()) return { ok: false, logs: [], error: "source is required" };
  const runId = crypto.randomUUID();
  await ensureOffscreen();
  pending.set(runId, dispatch);
  try { return await chrome.runtime.sendMessage({ target: "latch-run-offscreen", runId, source: args.source, timeoutMs: parseTimeoutMs(args.timeoutMs) }); }
  finally { pending.delete(runId); }
}
