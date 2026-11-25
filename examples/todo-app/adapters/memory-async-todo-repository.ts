import type { AsyncTodoRepository } from "../async-repository.ts";
import type { Todo } from "../types.ts";

/**
 * 等待一次模拟读写，取消时结束计时并通知调用方。
 * @param milliseconds 要等待的毫秒数。
 * @param signal 这次读写的取消信号。
 * @returns 模拟延迟结束时完成的 Promise。
 */
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // 已取消的信号不会再次发事件，所以要在注册监听前检查。
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);

    /** 通知调用方取消，同时清掉仍在等待的计时器。 */
    function abort(): void {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * 在内存里保存任务，给读写都加上可观察的延迟。
 * @param initial 仓库初始持有的任务。
 * @param latencyMs 一次读或写的模拟延迟，单位为毫秒。
 * @returns 可以被同一页里的多个挂载周期复用的异步仓库。
 */
export function createMemoryAsyncTodoRepository(
  initial: readonly Todo[],
  latencyMs = 2500,
): AsyncTodoRepository {
  // 仓库持有自己的副本，下一次读回的是它最后确认的列表。
  let stored = initial.map((todo) => ({ ...todo }));

  return {
    async load(signal) {
      // 发出读取时就取走这份快照，延迟只影响返回时间。
      const snapshot = stored.map((todo) => ({ ...todo }));
      await wait(latencyMs, signal);
      signal.throwIfAborted();
      return snapshot;
    },
    async save(snapshot, signal) {
      // 先复制请求带来的数据，到时仍有效才把副本交给仓库。
      const next = snapshot.map((todo) => ({ ...todo }));
      await wait(latencyMs, signal);
      signal.throwIfAborted();
      stored = next;
    },
  };
}
