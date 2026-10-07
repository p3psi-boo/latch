import assert from "node:assert/strict";
import test from "node:test";
import { durationMs, easeMove, hypot, path, smoothstep, wheelDeltas } from "./pointer-motion.ts";

test("durationMs matches ego lite clamp(round(2d), 120, 420)", () => {
  assert.equal(durationMs(0), 0);
  assert.equal(durationMs(30), 120);
  assert.equal(durationMs(80), 160);
  assert.equal(durationMs(200), 400);
  assert.equal(durationMs(400), 420);
});

test("durationMs raises the 420ms cap when speed would exceed 5000 px/s", () => {
  assert.equal(durationMs(2100), 420);
  assert.equal(durationMs(3000), 600);
});

test("smoothstep is 0, 0.5, 1 at the endpoints and midpoint", () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);
  assert.ok(smoothstep(0.25) < 0.25);
  assert.ok(smoothstep(0.75) > 0.75);
});

test("wheelDeltas is one frame at or under 120px and lands on the remainder", () => {
  assert.deepEqual(wheelDeltas(80, 0), [{ dx: 80, dy: 0 }]);
  assert.deepEqual(wheelDeltas(0, 120), [{ dx: 0, dy: 120 }]);
  const mid = wheelDeltas(0, 200);
  assert.equal(mid.length, 3);
  assert.equal(mid.reduce((sum, f) => sum + f.dy, 0), 200);
  const last = mid.at(-1)!;
  assert.ok(last.dy !== 0);
  const long = wheelDeltas(0, 2000);
  assert.equal(long.length, 12);
  assert.equal(long.reduce((sum, f) => sum + f.dy, 0), 2000);
});

test("easeMove is 0 at start, 1 at end, and strictly increasing", () => {
  assert.ok(Math.abs(easeMove(0)) < 1e-6);
  assert.ok(Math.abs(easeMove(1) - 1) < 1e-6);
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const y = easeMove(i / 20);
    assert.ok(y >= prev - 1e-9);
    prev = y;
  }
});

test("path is a straight line in the plane", () => {
  const start = { x: 100, y: 100 };
  const end = { x: 500, y: 280 };
  const samples = path(start, end);
  assert.ok(samples.length > 2);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  for (const p of samples) {
    const cross = Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx);
    assert.ok(cross < 1e-6, `off-line ${JSON.stringify(p)}`);
  }
  const last = samples.at(-1)!;
  assert.ok(hypot(last.x - end.x, last.y - end.y) < 1e-6);
});
