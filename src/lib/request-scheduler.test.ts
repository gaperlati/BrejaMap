/**
 * Tests for the request scheduler: run with `npm run test:scripts`. A virtual clock
 * replaces real waits, so spacing is checked without sleeping.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestScheduler, type SchedulerClock } from "./request-scheduler";

/** Virtual time: `sleep` advances the clock instantly (on a later macrotask). */
function virtualClock(): SchedulerClock & { sleeps: number[] } {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise((resolve) =>
        setImmediate(() => {
          t += ms;
          resolve();
        })
      );
    },
  };
}

test("request starts are spaced by the minimum interval, in call order", async () => {
  const clock = virtualClock();
  const scheduler = createRequestScheduler(1000, clock);
  const starts: [string, number][] = [];
  const run = (name: string) =>
    scheduler.schedule(async () => {
      starts.push([name, clock.now()]);
      return name;
    });
  assert.deepEqual(await Promise.all([run("a"), run("b"), run("c")]), ["a", "b", "c"]);
  assert.deepEqual(starts, [["a", 0], ["b", 1000], ["c", 2000]]);
});

test("a request after a long idle gap starts immediately", async () => {
  const clock = virtualClock();
  const scheduler = createRequestScheduler(1000, clock);
  await scheduler.schedule(async () => undefined);
  await clock.sleep(5000);
  const before = clock.sleeps.length;
  await scheduler.schedule(async () => undefined);
  assert.equal(clock.sleeps.length, before, "no extra wait");
});

test("spacing counts from the start, not the end, of the previous request", async () => {
  const clock = virtualClock();
  const scheduler = createRequestScheduler(1000, clock);
  const starts: number[] = [];
  // The first request is still running when the second one's slot comes.
  let finishSlow!: () => void;
  const slow = scheduler.schedule(() => {
    starts.push(clock.now());
    return new Promise<void>((resolve) => (finishSlow = resolve));
  });
  const fast = scheduler.schedule(async () => {
    starts.push(clock.now());
  });
  await fast;
  assert.deepEqual(starts, [0, 1000]);
  finishSlow();
  await slow;
});

test("a request cancelled while queued is never started and frees its slot", async () => {
  const clock = virtualClock();
  const scheduler = createRequestScheduler(1000, clock);
  const started: string[] = [];
  const startTimes: number[] = [];
  const task = (name: string) => async () => {
    started.push(name);
    startTimes.push(clock.now());
    return name;
  };
  const a = scheduler.schedule(task("a"));
  const stale = new AbortController();
  const b = scheduler.schedule(task("b"), stale.signal);
  const c = scheduler.schedule(task("c"));
  stale.abort();
  await assert.rejects(b, { name: "AbortError" });
  assert.deepEqual(await Promise.all([a, c]), ["a", "c"]);
  assert.deepEqual(started, ["a", "c"]);
  // "c" takes the slot "b" would have used.
  assert.deepEqual(startTimes, [0, 1000]);
});

test("cancelling rejects right away instead of waiting for the slot", async () => {
  const clock = virtualClock();
  const scheduler = createRequestScheduler(1000, clock);
  await scheduler.schedule(async () => undefined);
  const controller = new AbortController();
  let settled = false;
  const queued = scheduler.schedule(async () => "late", controller.signal).catch((e) => {
    settled = true;
    throw e;
  });
  controller.abort();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, true);
  await assert.rejects(queued, { name: "AbortError" });
});

test("an already-aborted signal never queues the request", async () => {
  const scheduler = createRequestScheduler(1000, virtualClock());
  let ran = false;
  await assert.rejects(
    scheduler.schedule(async () => {
      ran = true;
    }, AbortSignal.abort()),
    { name: "AbortError" }
  );
  assert.equal(ran, false);
});

test("a failing request still counts as a start and doesn't stall the queue", async () => {
  const clock = virtualClock();
  const scheduler = createRequestScheduler(1000, clock);
  const failing = scheduler.schedule(async () => {
    throw new Error("HTTP 503");
  });
  const throwing = scheduler.schedule((): Promise<never> => {
    throw new Error("sync throw");
  });
  const next = scheduler.schedule(async () => clock.now());
  await assert.rejects(failing, /503/);
  await assert.rejects(throwing, /sync throw/);
  assert.equal(await next, 2000);
});
