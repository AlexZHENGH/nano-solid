import { describe, expect, it, vi } from "vitest";
import { createAsyncResource, createEffect, createRoot, type AsyncState } from "./index.ts";

describe("异步资源", () => {
  it.skip("主动加载前保持空闲，订阅者可以依次观察 loading 和 success", async () => {
    // 由测试决定 Promise 何时完成，这样可以先检查中间的等待状态。
    const pending = Promise.withResolvers<number>();
    const loader = vi.fn(() => pending.promise);
    const seen: AsyncState<number>[] = [];
    const { resource, dispose } = createRoot((dispose) => {
      const resource = createAsyncResource(loader);
      createEffect(() => {
        seen.push(resource.state());
      });
      return { resource, dispose };
    });

    // 创建资源只提供状态。调用 reload 后，才开始工作并通知视图。
    expect(loader).not.toHaveBeenCalled();
    const task = resource.reload();
    const beforeResponse = seen.slice();
    pending.resolve(42);
    await task;
    expect(beforeResponse).toEqual([{ status: "idle" }, { status: "loading" }]);
    expect(seen).toEqual([
      { status: "idle" },
      { status: "loading" },
      { status: "success", data: 42 },
    ]);
    dispose();
  });

  it.skip("加载器同步抛错或异步拒绝时都写入 error，且可以重新加载", async () => {
    // 同步抛错和 Promise 拒绝共用状态接口。第三次加载模拟错误已经排除。
    const syncError = new Error("加载器缺少配置");
    const asyncError = new Error("网络不可用");
    const loader = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(() => {
        throw syncError;
      })
      .mockRejectedValueOnce(asyncError)
      .mockResolvedValueOnce(42);
    const resource = createAsyncResource(loader);

    // reload 可以正常结束，失败的原因留给读取 state 的界面。
    await resource.reload();
    expect(resource.state()).toEqual({ status: "error", error: syncError });
    await resource.reload();
    expect(resource.state()).toEqual({ status: "error", error: asyncError });
    await resource.reload();
    expect(resource.state()).toEqual({ status: "success", data: 42 });
  });

  it.skip("较早的请求即使忽略取消，迟到的成功响应也不会覆盖新数据", async () => {
    // 两次刷新分别读到勾选前后的列表。由测试决定哪一份先返回。
    type TodoSnapshot = { text: string; completed: boolean }[];
    const before: TodoSnapshot = [{ text: "订会议室", completed: false }];
    const after: TodoSnapshot = [{ text: "订会议室", completed: true }];
    const first = Promise.withResolvers<TodoSnapshot>();
    const second = Promise.withResolvers<TodoSnapshot>();
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<TodoSnapshot>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const resource = createAsyncResource(loader);
    const oldRequest = resource.reload();
    const newRequest = resource.reload();

    // 旧请求收到了取消信号，但这次由测试让它继续结束。
    expect(loader.mock.calls[0]?.[0].aborted).toBe(true);
    expect(loader.mock.calls[1]?.[0].aborted).toBe(false);

    // 先应用勾选后的列表，再让旧快照迟到，确认同一条任务仍是已完成。
    second.resolve(after);
    await newRequest;
    expect(resource.state()).toEqual({ status: "success", data: after });
    first.resolve(before);
    await oldRequest;
    expect(resource.state()).toEqual({ status: "success", data: after });
  });

  it.skip("忽略过期的失败，并在显式取消时回到 idle 且丢弃迟到的结果", async () => {
    // 先结束旧请求，检查它的收尾没有清除尚在等待的新请求的取消句柄。
    const first = Promise.withResolvers<number>();
    const second = Promise.withResolvers<number>();
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<number>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const resource = createAsyncResource(loader);
    const oldRequest = resource.reload();
    const newRequest = resource.reload();
    first.reject(new Error("过期请求失败"));
    await oldRequest;
    expect(resource.state()).toEqual({ status: "loading" });

    // 取消后即使 loader 继续返回，页面也应保持空闲。
    resource.cancel();
    expect(loader.mock.calls[1]?.[0].aborted).toBe(true);
    expect(resource.state()).toEqual({ status: "idle" });
    second.resolve(42);
    await newRequest;
    expect(resource.state()).toEqual({ status: "idle" });
  });

  it.skip("Owner 释放后停止当前请求，不再启动请求或变更状态", async () => {
    // 在根作用域内创建资源，让 dispose 管理仍在飞行中的请求。
    const pending = Promise.withResolvers<number>();
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<number>>()
      .mockReturnValue(pending.promise);
    const { resource, dispose } = createRoot((dispose) => ({
      resource: createAsyncResource(loader),
      dispose,
    }));
    const task = resource.reload();
    const beforeDispose = resource.state();

    // 卸载只停止工作。迟到的结果或后来调用的方法都不会改写最后的快照。
    dispose();
    expect(loader.mock.calls[0]?.[0].aborted).toBe(true);
    pending.resolve(42);
    await task;
    resource.cancel();
    await resource.reload();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(resource.state()).toBe(beforeDispose);
  });

  it.skip("订阅者在成功后抛错时保留成功快照，并让异常传给调用者", async () => {
    // 让 loader 成功，再模拟一个在更新界面时抛错的订阅者。
    const failure = new Error("更新视图失败");
    const { resource, dispose } = createRoot((dispose) => {
      const resource = createAsyncResource(async () => 42);
      createEffect(() => {
        if (resource.state().status === "success") throw failure;
      });
      return { resource, dispose };
    });

    // 订阅者失败不会把已经完成的加载改成 error 状态。
    await expect(resource.reload()).rejects.toBe(failure);
    expect(resource.state()).toEqual({ status: "success", data: 42 });
    dispose();
  });

  it.skip("订阅者在 loading 通知中取消时跳过 loader", async () => {
    // loading 会同步通知订阅者，订阅者可以在 loader 开始前取消。
    const loader = vi.fn(async () => 42);
    const { resource, dispose } = createRoot((dispose) => {
      const resource = createAsyncResource(loader);
      createEffect(() => {
        if (resource.state().status === "loading") resource.cancel();
      });
      return { resource, dispose };
    });

    // 返回 loading 通知后先确认当前请求仍有效，再决定是否真正开始加载。
    await resource.reload();
    expect(loader).not.toHaveBeenCalled();
    expect(resource.state()).toEqual({ status: "idle" });
    dispose();
  });

  it.skip("旧请求的取消监听发起新加载时，只有最后发起的请求进入 loader", async () => {
    // 取消请求会同步运行监听器。让第一次的 abort 事件立即发起第三次加载。
    const first = Promise.withResolvers<number>();
    const third = Promise.withResolvers<number>();
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<number>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(third.promise);
    const resource = createAsyncResource(loader);
    const oldRequest = resource.reload();
    let lastRequest: Promise<void> | undefined;
    loader.mock.calls[0]?.[0].addEventListener("abort", () => {
      lastRequest = resource.reload();
    });

    // 第二次加载已被第三次替代，不能继续调用 loader 或清除第三次请求的句柄。
    await resource.reload();
    expect(lastRequest).toBeDefined();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]?.[0].aborted).toBe(false);
    third.resolve(3);
    await lastRequest;
    first.resolve(1);
    await oldRequest;
    expect(resource.state()).toEqual({ status: "success", data: 3 });
  });
});
