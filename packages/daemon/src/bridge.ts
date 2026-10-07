import { randomUUID } from "node:crypto";
import {
  encodeWireMessage,
  parseWireMessage,
  type HelloPayload,
  type WireMessage,
} from "@latch/protocol";
import type { WebSocket } from "ws";

const TOOL_TIMEOUT_MS = 120_000;

type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class ExtensionBridge {
  private socket: WebSocket | null = null;
  private hello: HelloPayload | null = null;
  private readonly pending = new Map<string, Pending>();
  onHello?: (payload: HelloPayload) => void;

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === 1;
  }

  get extensionVersion(): string | undefined {
    return this.hello?.extensionVersion;
  }

  attach(socket: WebSocket): void {
    this.socket = socket;
    socket.on("message", (raw) => this.onMessage(String(raw)));
    socket.on("close", () => this.drop("extension disconnected"));
    socket.on("error", () => this.drop("extension socket error"));
  }

  shutdown(code = 1000, reason = "shutdown"): void {
    const socket = this.socket;
    this.drop(reason);
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
      try {
        socket.close(code, reason);
      } catch {
        /* ignore */
      }
    }
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.socket) {
      throw new Error(
        "Latch extension is not connected. Load the unpacked extension and wait until the toolbar icon shows connected.",
      );
    }
    const requestId = randomUUID();
    const message: WireMessage = {
      type: "tool_call",
      requestId,
      payload: { name, args },
    };
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`tool "${name}" timed out after ${TOOL_TIMEOUT_MS / 1000}s`));
      }, TOOL_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(encodeWireMessage(message));
    });
  }

  private onMessage(raw: string): void {
    let message: WireMessage;
    try {
      message = parseWireMessage(raw);
    } catch (error) {
      console.error("[latch] invalid wire message", error);
      return;
    }
    switch (message.type) {
      case "hello":
        this.hello = message.payload;
        this.socket?.send(
          encodeWireMessage({
            type: "hello_ack",
            payload: {
              daemonVersion: "0.1.0",
              protocolVersion: message.payload.protocolVersion,
            },
          }),
        );
        this.onHello?.(message.payload);
        return;
      case "ping":
        this.socket?.send(encodeWireMessage({ type: "pong" }));
        return;
      case "pong":
        return;
      case "tool_result": {
        const pending = this.pending.get(message.responseToRequestId);
        if (!pending) return;
        this.pending.delete(message.responseToRequestId);
        clearTimeout(pending.timer);
        if (message.payload.error) pending.reject(new Error(message.payload.error));
        else pending.resolve(message.payload.data);
        return;
      }
      default:
        return;
    }
  }

  private drop(reason: string): void {
    this.socket = null;
    this.hello = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
