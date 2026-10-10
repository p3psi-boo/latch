import type { SelectOptionMatch } from "@latch/protocol";

export function parseOptions(raw: unknown): SelectOptionMatch[] {
  const options = Array.isArray(raw) ? raw : [raw];
  for (const match of options) {
    if (!match || typeof match !== "object" || Array.isArray(match)) {
      throw new Error("select_option: option must specify value, label, or index");
    }
    const keys = Object.keys(match);
    if (keys.length !== 1 || !["value", "label", "index"].includes(keys[0]!)) {
      throw new Error("select_option: each option must specify exactly one of value, label, or index");
    }
    const key = keys[0]!;
    if (key === "index" ? !Number.isInteger(match.index) || match.index < 0 : typeof match[key] !== "string") {
      throw new Error(`select_option: invalid ${key}`);
    }
  }
  return options;
}

/** Runs in the page via Runtime.callFunctionOn; keep it free of module closures. */
export function selectNativeOptions(this: HTMLSelectElement, matches: SelectOptionMatch[]) {
  if (!(this instanceof HTMLSelectElement)) throw new Error("select_option: target is not a SELECT");
  if (this.disabled) throw new Error("select_option: SELECT is disabled");
  if (!this.multiple && matches.length !== 1) {
    throw new Error("select_option: a single SELECT requires exactly one option");
  }
  const options = Array.from(this.options);
  const desired = matches.map((match) => {
    const found = options.filter((option, index) =>
      "value" in match ? option.value === match.value :
        "label" in match ? option.label === match.label : index === match.index,
    );
    if (found.length !== 1) {
      throw new Error(found.length ? "select_option: option match is ambiguous" : "select_option: option not found");
    }
    const option = found[0]!;
    if (option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)) {
      throw new Error("select_option: option is disabled");
    }
    return option;
  });
  const wanted = new Set(desired);
  const changed = options.some((option) => option.selected !== wanted.has(option));
  if (changed) {
    for (const option of options) option.selected = wanted.has(option);
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const actual = Array.from(this.selectedOptions);
  if (!this.isConnected || actual.length !== wanted.size || actual.some((option) => !wanted.has(option))) {
    throw new Error("select_option: selected options did not match the request after input/change");
  }
  return {
    success: true,
    verified: true,
    mode: "dom",
    changed,
    values: actual.map((option) => option.value),
    labels: actual.map((option) => option.label),
  };
}
