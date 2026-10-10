export function requireUsableBox(
  box: { x: number; y: number; width: number; height: number; tag: string },
  tool: string,
): void {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
    const hint = box.tag === "OPTION" ? "; use select_option on its SELECT" : "";
    throw new Error(`${tool}: ${box.tag} has no usable layout box${hint}`);
  }
}
