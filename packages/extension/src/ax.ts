import { assignRef, resetRefs } from "./refs.ts";

export type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value: string };
  name?: { value: string };
  childIds?: string[];
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value: { value?: unknown } }>;
};

const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

const MAX_CHARS = 80_000;

export function formatAxTree(tabId: number, nodes: AxNode[]): { tree: string; truncated: boolean } {
  resetRefs(tabId);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const roots = nodes.filter((node) => !childIds.has(node.nodeId));
  const lines: string[] = [];

  const walk = (node: AxNode, depth: number): void => {
    if (node.ignored && !(node.childIds && node.childIds.length > 0)) return;
    const role = node.role?.value ?? "generic";
    const name = (node.name?.value ?? "").replace(/\s+/g, " ").trim();
    const interactive = INTERACTIVE.has(role) && node.backendDOMNodeId != null;
    const ref =
      interactive && node.backendDOMNodeId != null
        ? assignRef(tabId, node.backendDOMNodeId, role, name)
        : null;
    const label = name ? `${role} ${JSON.stringify(name)}` : role;
    const suffix = ref ? ` @${ref}` : "";
    lines.push(`${"  ".repeat(depth)}${label}${suffix}`);
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) walk(child, depth + 1);
    }
  };

  for (const root of roots) walk(root, 0);
  const joined = lines.join("\n");
  if (joined.length <= MAX_CHARS) return { tree: joined, truncated: false };
  return { tree: joined.slice(0, MAX_CHARS), truncated: true };
}
