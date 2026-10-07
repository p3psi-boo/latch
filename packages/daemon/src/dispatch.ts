import { isToolName } from "@latch/protocol";
import { ExtensionBridge } from "./bridge.ts";
import { persistScreenshot } from "./screenshots.ts";
import { applyToolSideEffects, SessionStore } from "./sessions.ts";

export async function dispatchCommand(
  bridge: ExtensionBridge,
  store: SessionStore,
  action: string,
  args: Record<string, unknown>,
  session: string,
): Promise<unknown> {
  if (!session.trim()) throw new Error("session is required");
  if (!isToolName(action)) throw new Error(`unknown action: ${action}`);
  if (typeof args.group_title === "string") store.noteTitle(session, args.group_title);
  const injected = store.inject(session, args);
  const data = await bridge.call(action, injected);
  const normalized = action === "screenshot" ? await persistScreenshot(data) : data;
  applyToolSideEffects(store, session, action, args, normalized);
  return normalized;
}
