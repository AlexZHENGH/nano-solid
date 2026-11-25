import { createSignal, onCleanup } from "./reactive.ts";

/** 一次加载的状态快照。只有成功时才有数据，只有失败时才有错误。 */
export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: unknown };

/** 通过 getter 订阅加载状态，通过动作重新加载或取消。 */
export type AsyncResource<T> = {
  /** 读取当前状态，并在响应式上下文里订阅后续变化。 */
  readonly state: () => AsyncState<T>;
  /** 发起新请求，等待这次 loader 结束。加载异常通过 state 报告。 */
  reload: () => Promise<void>;
  /** 作废当前请求，通知 loader 停止，仍在使用的资源回到 idle。 */
  cancel: () => void;
};

/**
 * 创建异步资源。只有最新请求可以发布结果，所属 Owner 释放时作废该请求。
 * @param loader 接收本次请求的 AbortSignal 并返回结果的加载函数。
 * @returns 读取请求状态、启动和取消加载的接口。
 */
export function createAsyncResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  // 状态和对应的数据一起发布。复用 idle 快照，连续取消时无需重复通知。
  const idle = { status: "idle" } as const;
  const [state, setState] = createSignal<AsyncState<T>>(idle);

  // 控制器同时记录取消句柄和发布资格。Owner 释放后禁止创建新的控制器。
  let active: AbortController | undefined;
  let disposed = false;

  /** 作废当前请求，让仍在使用的资源退回空闲状态。 */
  function cancel(): void {
    // 先收回旧请求的发布资格，再用它的取消句柄通知 loader 停止。
    if (disposed) return;
    const previous = active;
    active = undefined;

    // 通知订阅者可能抛错或开启新请求。无论发生什么，都只取消手中的旧请求。
    try {
      setState(idle);
    } finally {
      previous?.abort();
    }
  }

  /**
   * 启动一次加载，只有当前请求仍有效时才发布结果。
   * @returns 本次加载结束的 Promise。loader 的错误写入资源状态。
   */
  async function reload(): Promise<void> {
    // 用独立的 AbortController 标识本次请求，区分 loader 的失败与订阅者的失败。
    if (disposed) return;
    const previous = active;
    const request = new AbortController();
    active = request;

    try {
      // abort 监听和 loading 订阅者都可能同步取消或换掉当前请求。
      previous?.abort();
      if (active !== request) return;
      setState({ status: "loading" });
      if (active !== request) return;

      // 只捕获 loader 的异常。写状态时如有订阅者抛错，应交给 reload 的调用者。
      let result: AsyncState<T>;
      try {
        result = { status: "success", data: await loader(request.signal) };
      } catch (error) {
        result = { status: "error", error };
      }

      // await 期间可能发生重试、取消和卸载，只有当前请求还能写状态。
      if (active === request) setState(result);
    } finally {
      // 旧请求收尾时，新请求可能还在等待。只清掉自己的控制器。
      if (active === request) active = undefined;
    }
  }

  // Owner 离开时作废请求和取消句柄，避免迟到的响应更新已卸载的界面。
  onCleanup(() => {
    disposed = true;
    const previous = active;
    active = undefined;
    previous?.abort();
  });

  return { state, reload, cancel };
}
