import { describe, expect, it } from 'vitest';

import { ConcurrencyLimit } from './build-limit.server';

describe('ConcurrencyLimit', () => {
  it('runs at most its limit at once and starts the rest in arrival order', async () => {
    const limit = new ConcurrencyLimit(2);
    const started: number[] = [];
    const finish = new Map<number, () => void>();
    const task = (id: number) => () =>
      new Promise<number>((resolve) => {
        started.push(id);
        finish.set(id, () => resolve(id));
      });

    const runs = [1, 2, 3, 4].map((id) => limit.run(task(id)));
    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    finish.get(2)!();
    await expect(runs[1]).resolves.toBe(2);
    expect(started).toEqual([1, 2, 3]);
    finish.get(1)!();
    finish.get(3)!();
    await Promise.all(runs.slice(0, 3));
    expect(started).toEqual([1, 2, 3, 4]);
    finish.get(4)!();
    await expect(runs[3]).resolves.toBe(4);
  });

  it('frees its place when a task fails', async () => {
    const limit = new ConcurrencyLimit(1);
    await expect(limit.run(() => Promise.reject(new Error('Broke.')))).rejects.toThrow('Broke.');
    await expect(limit.run(async () => 'next')).resolves.toBe('next');
  });

  it('never starts a task whose signal aborts while it waits', async () => {
    const limit = new ConcurrencyLimit(1);
    let release!: () => void;
    const running = limit.run(() => new Promise<void>((resolve) => (release = resolve)));
    const controller = new AbortController();
    let started = false;
    const waiting = limit.run(async () => {
      started = true;
    }, controller.signal);

    controller.abort(new Error('Superseded.'));
    await expect(waiting).rejects.toThrow('Superseded.');
    release();
    await running;
    await expect(limit.run(async () => 'after')).resolves.toBe('after');
    expect(started).toBe(false);
  });
});
