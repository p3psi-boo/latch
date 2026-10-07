/** ego lite 0.5.1.13 AgentMouseLayerView timing, applied to real CDP mouse events. */

export type Point = { x: number; y: number };

export function hypot(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

export const MS_PER_PX = 2;
export const DURATION_MIN_MS = 120;
export const DURATION_MAX_MS = 420;
export const MAX_SPEED_PX_S = 5000;
export const INPUT_EVENT_DELAY_MS = 25;
export const WHEEL_SINGLE_EVENT_DISTANCE = 120;
export const WHEEL_PIXELS_PER_STEP = 80;
export const WHEEL_MAX_STEPS = 12;
export const WHEEL_STEP_INTERVAL_MS = 8;
export const AUTO_SCROLL_ATTEMPTS = 6;
export const FILL_VERIFY_ATTEMPTS = 5;
export const FILL_VERIFY_INTERVAL_MS = 50;

export function durationMs(distancePx: number): number {
  if (distancePx <= 0) return 0;
  let ms = Math.max(DURATION_MIN_MS, Math.min(DURATION_MAX_MS, Math.round(MS_PER_PX * distancePx)));
  const seconds = ms / 1000;
  if (distancePx / seconds > MAX_SPEED_PX_S) {
    ms = Math.round((distancePx / MAX_SPEED_PX_S) * 1000);
  }
  return ms;
}

export function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** ego lite dispatchWheelMotion. Last frame lands on the exact remainder. */
export function wheelDeltas(deltaX: number, deltaY: number): Array<{ dx: number; dy: number }> {
  const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  const steps =
    distance <= WHEEL_SINGLE_EVENT_DISTANCE
      ? 1
      : Math.min(WHEEL_MAX_STEPS, Math.ceil(distance / WHEEL_PIXELS_PER_STEP));
  let emittedX = 0;
  let emittedY = 0;
  const frames: Array<{ dx: number; dy: number }> = [];
  for (let step = 1; step <= steps; step++) {
    const eased = smoothstep(step / steps);
    const cumX = step === steps ? deltaX : deltaX * eased;
    const cumY = step === steps ? deltaY : deltaY * eased;
    frames.push({ dx: cumX - emittedX, dy: cumY - emittedY });
    emittedX = cumX;
    emittedY = cumY;
  }
  return frames;
}

export function cubicBezier1d(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const sampleX = (t: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
  };
  const sampleY = (t: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
  };
  const sampleDx = (t: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * x1 + 6 * mt * t * (x2 - x1) + 3 * t * t * (1 - x2);
  };

  let t = x;
  let newtonDone = true;
  for (let i = 0; i < 8; i++) {
    const xEst = sampleX(t) - x;
    const dx = sampleDx(t);
    if (Math.abs(dx) < 1e-6) {
      newtonDone = false;
      break;
    }
    t -= xEst / dx;
    if (t < 0 || t > 1) {
      newtonDone = false;
      break;
    }
  }
  if (newtonDone) return sampleY(Math.max(0, Math.min(1, t)));

  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 12; i++) {
    const xEst = sampleX(t);
    if (Math.abs(xEst - x) < 1e-6) break;
    if (xEst < x) lo = t;
    else hi = t;
    t = 0.5 * (lo + hi);
  }
  return sampleY(t);
}

/** cubic-bezier(0.2, 0, 0, 1) — FAST_OUT_SLOW_IN_3 */
export function easeMove(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return cubicBezier1d(0.2, 0, 0, 1, clamped);
}

export function lerp(start: Point, end: Point, u: number): Point {
  return {
    x: start.x + (end.x - start.x) * u,
    y: start.y + (end.y - start.y) * u,
  };
}

export function path(start: Point, end: Point, fps = 60): Point[] {
  const dist = hypot(end.x - start.x, end.y - start.y);
  const ms = durationMs(dist);
  if (ms === 0) return [{ ...end }];
  const frames = Math.max(1, Math.round((ms / 1000) * fps));
  const out: Point[] = [];
  for (let i = 0; i <= frames; i++) {
    out.push(lerp(start, end, easeMove(i / frames)));
  }
  return out;
}
