const attached = new Set<number>();
const inflight = new Map<number, Promise<void>>();
const CDP_TIMEOUT_MS = 120_000;

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export async function attach(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  const existing = inflight.get(tabId);
  if (existing) return existing;
  const work = (async () => {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      /* not attached */
    }
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (error) {
      throw asError(error);
    }
    attached.add(tabId);
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.enable");
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
      await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable");
    } catch {
      /* page domains are best-effort */
    }
  })().finally(() => inflight.delete(tabId));
  inflight.set(tabId, work);
  return work;
}

/**
 * Background tabs freeze input: mouseWheel waits for a renderer ACK that never
 * comes. Keep the page in the active lifecycle and emulate focus so CDP wheel
 * (and other blocking input) can complete without stealing the user's window.
 */
export async function wakeRenderer(tabId: number): Promise<void> {
  await attach(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", { state: "active" });
  } catch {
    /* not every target implements it */
  }
  try {
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch {
    /* ignore */
  }
}

export async function send<T = Record<string, unknown>>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  await attach(tabId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${method} timed out after ${CDP_TIMEOUT_MS / 1000}s — the tab may be closed or the debugger detached.`,
          ),
        ),
      CDP_TIMEOUT_MS,
    );
  });
  try {
    const result = await Promise.race([
      chrome.debugger.sendCommand({ tabId }, method, params ?? {}),
      timeout,
    ]);
    return (result ?? {}) as T;
  } catch (error) {
    throw asError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attached.delete(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
});
