import {
  CLOSE_CODES,
  normalizeRemark,
  parseBrowserId,
  type BrowserInfo,
  type HelloPayload,
} from "@latch/protocol";
import type { WebSocket } from "ws";
import { ExtensionBridge } from "./bridge.ts";

const HELLO_TIMEOUT_MS = 10_000;

export type BrowserSlot = {
  id: string;
  remark?: string;
  bridge: ExtensionBridge;
};

export class Hub {
  private readonly browsers = new Map<string, BrowserSlot>();

  private readonly subscribers = new Set<() => void>();
  subscribe(callback: () => void): () => void { this.subscribers.add(callback); return () => { this.subscribers.delete(callback); }; }
  connectedSlots(): BrowserSlot[] { return [...this.browsers.values()].filter((slot) => slot.bridge.connected); }
  accept(socket: WebSocket): void {
    const incoming = new ExtensionBridge();
    const timer = setTimeout(() => {
      const claimed = [...this.browsers.values()].some((slot) => slot.bridge === incoming);
      if (!claimed) incoming.shutdown(CLOSE_CODES.badHello, "hello timeout");
    }, HELLO_TIMEOUT_MS);
    incoming.onHello = (payload) => {
      clearTimeout(timer);
      try {
        this.claimFromHello(payload, incoming);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        incoming.shutdown(CLOSE_CODES.badHello, message.slice(0, 120));
      }
    };
    incoming.onToolsChanged = () => { for (const callback of this.subscribers) callback(); };
    incoming.attach(socket);
  }

  claim(id: string, remark: string | undefined, incoming: ExtensionBridge): BrowserSlot {
    let slot = this.browsers.get(id);
    if (!slot) {
      slot = { id, remark, bridge: incoming };
      this.browsers.set(id, slot);
      return slot;
    }
    slot.remark = remark;
    if (slot.bridge !== incoming) {
      slot.bridge.shutdown(
        CLOSE_CODES.replaced,
        "replaced by reconnect of the same browser id",
      );
      slot.bridge = incoming;
    }
    return slot;
  }

  resolve(browserId?: string): BrowserSlot {
    return pickBrowser([...this.browsers.values()], browserId);
  }

  list(): BrowserInfo[] {
    return [...this.browsers.values()].map((slot) => ({
      id: slot.id,
      remark: slot.remark,
      connected: slot.bridge.connected,
      extensionVersion: slot.bridge.extensionVersion,
    }));
  }

  size(): number {
    return this.browsers.size;
  }

  private claimFromHello(payload: HelloPayload, incoming: ExtensionBridge): BrowserSlot {
    const parsed = parseBrowserId(payload.browserId);
    if (!parsed.ok) throw new Error(parsed.error);
    const remark = normalizeRemark(payload.remark);
    const slot = this.claim(parsed.id, remark, incoming);
    const label = slot.remark ? `${slot.id} (${slot.remark})` : slot.id;
    console.error(`[latch] browser ${label} connected, extension ${payload.extensionVersion}`);
    return slot;
  }
}

export function pickBrowser(slots: readonly BrowserSlot[], browserId?: string): BrowserSlot {
  const connected = slots.filter((slot) => slot.bridge.connected);
  const raw = typeof browserId === "string" ? browserId.trim() : "";
  if (raw) {
    const parsed = parseBrowserId(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const slot = slots.find((item) => item.id === parsed.id);
    if (!slot) {
      throw new Error(`unknown browser "${parsed.id}". ${formatKnown(slots, connected)}`);
    }
    if (!slot.bridge.connected) {
      throw new Error(`browser "${slot.id}" is not connected. ${formatKnown(slots, connected)}`);
    }
    return slot;
  }
  if (connected.length === 1) return connected[0]!;
  if (connected.length === 0) {
    throw new Error(
      "no Latch browser is connected. Set a browser id in the extension options and wait until the toolbar icon is connected.",
    );
  }
  const names = connected.map(describeSlot).join(", ");
  throw new Error(`multiple browsers connected (${names}). Pass "browser" with the id.`);
}

function describeSlot(slot: BrowserSlot): string {
  return slot.remark ? `${slot.id} (${slot.remark})` : slot.id;
}

function formatKnown(slots: readonly BrowserSlot[], connected: readonly BrowserSlot[]): string {
  const listed = (items: readonly BrowserSlot[]) =>
    items.length ? items.map(describeSlot).join(", ") : "(none)";
  return `connected: ${listed(connected)}; known: ${listed(slots)}`;
}
