import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { parseOptions, selectNativeOptions } from "./select-option.ts";
import { requireUsableBox } from "./element-box.ts";

class Group { disabled = false; }
class Select {
  disabled = false;
  multiple = false;
  isConnected = true;
  events: string[] = [];
  onChange?: () => void;
  options = ["One", "Two", "Three"].map((label, index) => ({
    label, value: String(index + 1), selected: index === 0, disabled: false,
    parentElement: null as Group | null,
  }));
  get selectedOptions() { return this.options.filter((option) => option.selected); }
  dispatchEvent(event: Event) {
    this.events.push(event.type);
    if (event.type === "change") this.onChange?.();
    return true;
  }
}

// Test the exact standalone function declaration sent into the page, without module closures.
const select = vm.runInNewContext(`(${selectNativeOptions.toString()})`, {
  HTMLSelectElement: Select, HTMLOptGroupElement: Group, Event,
}) as (this: Select, matches: ReturnType<typeof parseOptions>) => ReturnType<typeof selectNativeOptions>;

test("select_option matches value, label, and index and verifies the actual values", () => {
  for (const match of [{ value: "2" }, { label: "Two" }, { index: 1 }]) {
    const target = new Select();
    const result = select.call(target, parseOptions(match));
    assert.deepEqual([...result.values], ["2"]);
    assert.deepEqual([...result.labels], ["Two"]);
    assert.equal(result.verified, true);
    assert.equal(result.mode, "dom");
    assert.deepEqual(target.events, ["input", "change"]);
    assert.equal(select.call(target, parseOptions(match)).changed, false);
    assert.deepEqual(target.events, ["input", "change"]);
  }
});

test("multiple selection replaces all previous selections and can be cleared", () => {
  const target = new Select();
  target.multiple = true;
  const result = select.call(target, parseOptions([{ value: "3" }, { label: "Two" }]));
  assert.deepEqual([...result.values], ["2", "3"]);
  assert.deepEqual([...select.call(target, []).values], []);
  assert.throws(() => select.call(new Select(), []), /exactly one option/);
});

test("invalid match requests are rejected before selection", () => {
  for (const raw of [undefined, null, "Two", {}, { value: "2", label: "Two" }, { index: -1 }, { index: 1.5 }, { label: 2 }]) {
    assert.throws(() => parseOptions(raw), /select_option:/);
  }
});

test("missing, ambiguous, disabled, and non-SELECT targets fail without changing selection", () => {
  const target = new Select();
  assert.throws(() => select.call({} as Select, [{ value: "2" }]), /not a SELECT/);
  assert.throws(() => select.call(target, [{ value: "missing" }]), /not found/);
  target.options[2]!.label = "Two";
  assert.throws(() => select.call(target, [{ label: "Two" }]), /ambiguous/);
  target.options[1]!.disabled = true;
  assert.throws(() => select.call(target, [{ value: "2" }]), /option is disabled/);
  target.options[1]!.disabled = false;
  const group = new Group();
  group.disabled = true;
  target.options[1]!.parentElement = group;
  assert.throws(() => select.call(target, [{ value: "2" }]), /option is disabled/);
  target.disabled = true;
  assert.throws(() => select.call(target, [{ value: "2" }]), /SELECT is disabled/);
  assert.equal(target.selectedOptions[0]!.value, "1");
  assert.deepEqual(target.events, []);
});

test("change handlers that undo selection or remove the SELECT cause verification failure", () => {
  const target = new Select();
  target.onChange = () => { target.options[1]!.selected = false; target.options[0]!.selected = true; };
  assert.throws(() => select.call(target, [{ value: "2" }]), /did not match/);
  const removed = new Select();
  removed.onChange = () => { removed.isConnected = false; };
  assert.throws(() => select.call(removed, [{ value: "2" }]), /did not match/);
});

test("zero-area OPTION and non-finite coordinates cannot become mouse clicks", () => {
  assert.throws(() => requireUsableBox({ x: 0, y: 0, width: 0, height: 0, tag: "OPTION" }, "click"), /use select_option/);
  assert.throws(() => requireUsableBox({ x: NaN, y: 0, width: 20, height: 20, tag: "BUTTON" }, "click"), /no usable layout box/);
  assert.throws(() => requireUsableBox({ x: 0, y: 0, width: 20, height: 0, tag: "BUTTON" }, "click"), /no usable layout box/);
  requireUsableBox({ x: 0, y: 0, width: 20, height: 20, tag: "BUTTON" }, "click");
});
