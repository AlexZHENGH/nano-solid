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
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  loader: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  // 状态和对应的数据一起发布。复用 idle 快照，连续取消时无需重复通知。
  const idle = { status: "idle" } as const;
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const [state, setState] = createSignal<AsyncState<T>>(idle);

  /** 作废当前请求，让仍在使用的资源退回空闲状态。 */
  function cancel(): void {
    // 先收回旧请求的发布资格，再用它的取消句柄通知 loader 停止。
    // TODO: 作废当前请求、发布空闲状态并通知旧请求停止。
    throw new Error("TODO: 取消异步请求");
  }

  /**
   * 启动一次加载，只有当前请求仍有效时才发布结果。
   * @returns 本次加载结束的 Promise。loader 的错误写入资源状态。
   */
  async function reload(): Promise<void> {
    // 用独立的 AbortController 标识本次请求，区分 loader 的失败与订阅者的失败。
    // TODO: 替换旧请求、运行 loader 并发布仍然有效的结果。
    throw new Error("TODO: 重新加载异步资源");
  }

  // Owner 离开时作废请求和取消句柄，避免迟到的响应更新已卸载的界面。
  onCleanup(() => {
    // TODO: 停止当前请求并禁止后续加载。
  });

  return { state, reload, cancel };
}
