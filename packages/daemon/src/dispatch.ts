import type { ExtensionBridge } from "./bridge.ts";
import type { BrowserInfo } from "@latch/protocol";

export async function dispatchCommand(bridge: ExtensionBridge, action: string, args: Record<string, unknown>, session: string, browsers?: BrowserInfo[]): Promise<unknown> {
  return bridge.call(action, args, session, browsers);
}
