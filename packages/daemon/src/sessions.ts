export type SessionState = {
  name: string;
  currentTabId?: number;
  tabIds: number[];
  ownedTabIds: number[];
  groupTitle?: string;
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  get(name: string): SessionState {
    const existing = this.sessions.get(name);
    if (existing) return existing;
    const created: SessionState = {
      name,
      tabIds: [],
      ownedTabIds: [],
    };
    this.sessions.set(name, created);
    return created;
  }

  noteTitle(name: string, title: string | undefined): void {
    if (!title?.trim()) return;
    this.get(name).groupTitle = title.trim();
  }

  bind(name: string, tabId: number, owned: boolean): SessionState {
    const session = this.get(name);
    if (!session.tabIds.includes(tabId)) session.tabIds.push(tabId);
    if (owned && !session.ownedTabIds.includes(tabId)) session.ownedTabIds.push(tabId);
    session.currentTabId = tabId;
    return session;
  }

  forgetTab(tabId: number): void {
    for (const session of this.sessions.values()) {
      session.tabIds = session.tabIds.filter((id) => id !== tabId);
      session.ownedTabIds = session.ownedTabIds.filter((id) => id !== tabId);
      if (session.currentTabId === tabId) session.currentTabId = session.tabIds.at(-1);
    }
  }

  close(name: string): number[] {
    const session = this.sessions.get(name);
    if (!session) return [];
    const owned = [...session.ownedTabIds];
    this.sessions.delete(name);
    return owned;
  }

  inject(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const session = this.get(name);
    return {
      ...args,
      _session: name,
      _tabId: session.currentTabId,
      _tabIds: [...session.tabIds],
      _ownedTabIds: [...session.ownedTabIds],
    };
  }
}

export function applyToolSideEffects(
  store: SessionStore,
  session: string,
  action: string,
  args: Record<string, unknown>,
  data: unknown,
): void {
  if (action === "close_session") {
    store.close(session);
    return;
  }
  if (data && typeof data === "object" && "tabId" in data && typeof data.tabId === "number") {
    const borrowed = "borrowed" in data && data.borrowed === true;
    store.bind(session, data.tabId, !borrowed);
  }
  if (action === "navigate" && typeof args.group_title === "string") {
    store.noteTitle(session, args.group_title);
  }
}
