/**
 * Serializes request *starts* so that consecutive calls begin at least `minIntervalMs`
 * apart (e.g. Nominatim's 1 request/second usage policy). Requests run in call order;
 * a request whose signal aborts while it waits for its slot leaves the queue at once,
 * rejects with an AbortError and is never started, so it doesn't use up a slot.
 *
 * Kept free of React/Next/browser imports so it can be tested with `node --test`.
 */

export interface SchedulerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RequestScheduler {
  /** Runs `task` once its turn comes; `signal` cancels it while it is still queued. */
  schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

const realClock: SchedulerClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface QueuedTask {
  start: () => void;
}

export function abortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

export function createRequestScheduler(
  minIntervalMs: number,
  clock: SchedulerClock = realClock
): RequestScheduler {
  const queue: QueuedTask[] = [];
  let lastStart = Number.NEGATIVE_INFINITY;
  let pumping = false;

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const wait = lastStart + minIntervalMs - clock.now();
        if (wait > 0) {
          await clock.sleep(wait);
          // The head may have been cancelled meanwhile: re-check the queue and the time.
          continue;
        }
        const next = queue.shift()!;
        lastStart = clock.now();
        next.start();
      }
    } finally {
      pumping = false;
    }
  };

  return {
    schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          const index = queue.indexOf(entry);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(abortError());
          }
        };
        const entry: QueuedTask = {
          start: () => {
            signal?.removeEventListener("abort", onAbort);
            let running: Promise<T>;
            try {
              running = task();
            } catch (err) {
              running = Promise.reject(err);
            }
            running.then(resolve, reject);
          },
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(entry);
        void pump();
      });
    },
  };
}
