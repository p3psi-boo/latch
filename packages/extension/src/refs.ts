export type ElementRef = {
  backendDOMNodeId: number;
  role: string;
  name: string;
};

type TabRefs = {
  refs: Map<string, ElementRef>;
  next: number;
};

const tabs = new Map<number, TabRefs>();

function bucket(tabId: number): TabRefs {
  let found = tabs.get(tabId);
  if (!found) {
    found = { refs: new Map(), next: 1 };
    tabs.set(tabId, found);
  }
  return found;
}

export function resetRefs(tabId: number): void {
  tabs.delete(tabId);
}

export function assignRef(
  tabId: number,
  backendDOMNodeId: number,
  role: string,
  name: string,
): string {
  const state = bucket(tabId);
  const id = `e${state.next++}`;
  state.refs.set(id, { backendDOMNodeId, role, name });
  return id;
}

export function lookupRef(tabId: number, selector: string): ElementRef | undefined {
  const key = selector.startsWith("@") ? selector.slice(1) : selector;
  return tabs.get(tabId)?.refs.get(key);
}

export function isRef(selector: string): boolean {
  return /^@?e\d+$/.test(selector);
}

if (typeof chrome !== "undefined" && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));
}
