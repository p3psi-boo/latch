const sessionToGroup = new Map<string, number>();
const COLORS: chrome.tabGroups.Color[] = [
  "blue",
  "cyan",
  "green",
  "grey",
  "orange",
  "pink",
  "purple",
  "red",
  "yellow",
];
let colorCursor = 0;

function fallbackTitle(session: string): string {
  return session.slice(0, 24);
}

export async function groupTab(
  tabId: number,
  session: string | undefined,
  title: string | undefined,
): Promise<void> {
  if (!session) return;
  const label = title?.trim() || fallbackTitle(session);
  const existing = sessionToGroup.get(session);
  try {
    if (existing != null) {
      await chrome.tabs.group({ tabIds: tabId, groupId: existing });
      if (title?.trim()) await chrome.tabGroups.update(existing, { title: label });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: tabId });
    const color = COLORS[colorCursor++ % COLORS.length]!;
    await chrome.tabGroups.update(groupId, { title: label, color, collapsed: false });
    sessionToGroup.set(session, groupId);
  } catch (error) {
    console.warn("[latch] tab group failed", session, error);
  }
}

chrome.tabGroups?.onRemoved.addListener((group) => {
  for (const [session, id] of sessionToGroup) {
    if (id === group.id) sessionToGroup.delete(session);
  }
});
