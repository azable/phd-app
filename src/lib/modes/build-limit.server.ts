/** A bound on how many tasks run at once, the rest waiting in arrival order. */
export class ConcurrencyLimit {
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(readonly limit: number) {}

  /** Run the task once a place is free; a task whose signal aborts while waiting never starts. */
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.#enter(signal);
    try {
      return await task();
    } finally {
      this.#running -= 1;
      this.#waiting.shift()?.();
    }
  }

  #enter(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.#running < this.limit) {
      this.#running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const admit = () => {
        signal?.removeEventListener('abort', leave);
        this.#running += 1;
        resolve();
      };
      const leave = () => {
        this.#waiting.splice(this.#waiting.indexOf(admit), 1);
        reject(signal?.reason);
      };
      this.#waiting.push(admit);
      signal?.addEventListener('abort', leave, { once: true });
    });
  }
}

/**
 * Builds are the operations' CPU and memory work: compiling a component on the main thread and
 * laying it out in an isolate of up to 256 MB (layout.server.ts). Two at once keep a build's wait
 * short on the deployment's one CPU and 2 GB (render.yaml), while the operations around them,
 * mostly waiting on the model, run more widely (operations.ts).
 */
export const buildLimit = new ConcurrencyLimit(2);
