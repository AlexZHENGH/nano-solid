import { createRoot } from "nano-solid";
import { describe, expect, it, vi } from "vitest";
import type { AsyncTodoRepository } from "./async-repository.ts";
import { createAsyncTodoStore } from "./async-todo-store.ts";
import type { Todo } from "./types.ts";

/** 用已有编号验证加载后分配的新任务不会撞号。 */
const initial: readonly Todo[] = [{ id: 10, text: "订会议室", completed: false }];

/**
 * 像浏览器入口一样在 Owner 下创建 Store，让单测能够模拟卸载。
 * @param repository 由测试控制完成时间的仓库。
 * @returns Store 和卸载它的函数。
 */
function start(repository: AsyncTodoRepository) {
  return createRoot((dispose) => ({ store: createAsyncTodoStore(repository), dispose }));
}

describe("异步 Todo Store", () => {
  it("先读到仓库快照再开放编辑，初次读取与无效命令都不会触发保存", async () => {
    // 请求还没返回时，列表为空，提前编辑不能把这个空状态写回仓库。
    const loading = Promise.withResolvers<readonly Todo[]>();
    const save = vi.fn(async () => {});
    const { store, dispose } = start({ load: () => loading.promise, save });
    expect(store.loadStatus()).toBe("loading");
    store.addTodo("过早的修改");
    expect(store.todos()).toEqual([]);

    // 恢复列表时没有发生编辑，筛选和重复改名也不产生新快照。
    loading.resolve(initial);
    await vi.waitFor(() => expect(store.loadStatus()).toBe("ready"));
    expect(store.todos()).toEqual(initial);
    store.setFilter("active");
    store.updateTodo(10, "订会议室");
    expect(save).not.toHaveBeenCalled();
    dispose();
  });

  it("第一次读取失败可以重试，加载成功后保留已经可以编辑的列表", async () => {
    // 第一次读取失败，第二次取到数据。已经有可编辑列表时不再重读。
    const load = vi.fn<AsyncTodoRepository["load"]>().mockRejectedValueOnce(new Error("读取失败"));
    load.mockResolvedValueOnce(initial);
    const { store, dispose } = start({ load, save: async () => {} });
    await vi.waitFor(() => expect(store.loadStatus()).toBe("error"));
    await store.retryLoad();
    expect(store.loadStatus()).toBe("ready");
    store.addTodo("准备议程");
    await store.retryLoad();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.todos()).toEqual([...initial, { id: 11, text: "准备议程", completed: false }]);
    dispose();
  });

  it("编辑立即显示，等待确认期间只保留最新快照，仓库始终串行写入", async () => {
    // 先挡住第一笔保存，同时让用户继续勾选和改名。
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const save = vi
      .fn<AsyncTodoRepository["save"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { store, dispose } = start({ load: async () => initial, save });
    await vi.waitFor(() => expect(store.loadStatus()).toBe("ready"));
    store.addTodo("准备议程");
    store.toggleTodo(11);
    store.updateTodo(11, "发出议程");
    expect(store.todos()[1]).toEqual({ id: 11, text: "发出议程", completed: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0][1]).toEqual({ id: 11, text: "准备议程", completed: false });

    // 第一笔确认后才发送最新列表。第二笔仍未确认时，页面继续显示保存中。
    first.resolve();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0]).toEqual(store.todos());
    expect(store.saving()).toBe(true);
    expect(store.hasUnsavedChanges()).toBe(true);
    second.resolve();
    await vi.waitFor(() => expect(store.saving()).toBe(false));
    expect(store.hasUnsavedChanges()).toBe(false);
    dispose();
  });

  it("保存失败后保留本地编辑，手动重试提交最新的一份列表", async () => {
    // 第一笔写入失败时，用户已经在界面做了第二次修改。
    const first = Promise.withResolvers<void>();
    const save = vi
      .fn<AsyncTodoRepository["save"]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);
    const { store, dispose } = start({ load: async () => initial, save });
    await vi.waitFor(() => expect(store.loadStatus()).toBe("ready"));
    store.toggleTodo(10);
    store.updateTodo(10, "确认会议室");
    expect(save).toHaveBeenCalledTimes(1);
    first.reject(new Error("保存失败"));
    await vi.waitFor(() => expect(store.saveError()).toBe(true));
    expect(store.saving()).toBe(false);
    expect(store.hasUnsavedChanges()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    // 重试的是手头的新列表，确认后撤下失败和未保存提示。
    await store.retrySave();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toEqual([{ id: 10, text: "确认会议室", completed: true }]);
    expect(store.hasUnsavedChanges()).toBe(false);
    expect(store.saveError()).toBe(false);
    dispose();
  });

  it("卸载期间收到的读取结果不会装入旧 Store", async () => {
    // 仓库故意不监听取消，关闭页面后仍可让旧 Promise 返回。
    const loading = Promise.withResolvers<readonly Todo[]>();
    const load = vi.fn<AsyncTodoRepository["load"]>().mockReturnValue(loading.promise);
    const { store, dispose } = start({ load, save: async () => {} });
    dispose();
    expect(load.mock.calls[0]?.[0].aborted).toBe(true);
    loading.resolve(initial);
    await loading.promise;
    expect(store.todos()).toEqual([]);
  });

  it("卸载时取消在路上的写入，迟到的确认也不会触发下一笔", async () => {
    // 仓库暂不完成第一笔保存。下一次编辑已经在等它结束。
    const first = Promise.withResolvers<void>();
    const save = vi.fn<AsyncTodoRepository["save"]>().mockReturnValue(first.promise);
    const { store, dispose } = start({ load: async () => initial, save });
    await vi.waitFor(() => expect(store.loadStatus()).toBe("ready"));
    store.toggleTodo(10);
    store.updateTodo(10, "确认会议室");
    dispose();
    expect(save.mock.calls[0]?.[1].aborted).toBe(true);

    // 即使仓库忽略取消并确认了第一笔，已销毁的 Store 也不会继续写入。
    first.resolve();
    await first.promise;
    await store.retrySave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.hasUnsavedChanges()).toBe(true);
  });
});
