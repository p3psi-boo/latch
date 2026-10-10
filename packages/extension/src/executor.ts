import { SessionStore, applyToolSideEffects } from "./sessions.ts";
import { executeTool } from "./tools.ts";
import { executeRun } from "./run.ts";

const store = new SessionStore();
let loaded: Promise<void> | undefined;
const key = "latch_sessions";
function load() {
  return loaded ??= chrome.storage.session.get(key).then((data) => store.restore(data[key]));
}
export async function executeCommand(name: string, args: Record<string, unknown>, session: string): Promise<unknown> {
  if (!session.trim()) throw new Error("session is required");
  if (name === "run") return executeRun(args, (tool, parameters) => executeCommand(tool, parameters, session));
  await load();
  // Internal state always comes from the plugin, never from client-supplied _ fields.
  const clean = Object.fromEntries(Object.entries(args).filter(([field]) => !field.startsWith("_")));
  if (typeof clean.group_title === "string") store.noteTitle(session, clean.group_title);
  const data = await executeTool(name, store.inject(session, clean));
  applyToolSideEffects(store, session, name, clean, data);
  if (name === "close_tab") store.forgetTab(Number(store.get(session).currentTabId));
  await chrome.storage.session.set({ [key]: store.dump() });
  return data;
}
