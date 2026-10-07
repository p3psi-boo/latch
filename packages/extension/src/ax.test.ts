import assert from "node:assert/strict";
import test from "node:test";
import { formatAxTree, type AxNode } from "./ax.ts";

test("assigns @e refs to interactive nodes only", () => {
  const nodes: AxNode[] = [
    {
      nodeId: "1",
      role: { value: "RootWebArea" },
      name: { value: "Example" },
      childIds: ["2", "3"],
    },
    {
      nodeId: "2",
      role: { value: "heading" },
      name: { value: "Hello" },
    },
    {
      nodeId: "3",
      role: { value: "button" },
      name: { value: "Go" },
      backendDOMNodeId: 42,
    },
  ];
  const { tree, truncated } = formatAxTree(1, nodes);
  assert.equal(truncated, false);
  assert.match(tree, /RootWebArea "Example"/);
  assert.match(tree, /heading "Hello"/);
  assert.match(tree, /button "Go" @e1/);
  assert.doesNotMatch(tree, /heading .*@e/);
});
