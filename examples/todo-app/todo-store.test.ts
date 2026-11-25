import { createRoot } from "nano-solid";
import { describe, expect, it } from "vitest";
import { createMemoryTodoStorage } from "./test-support/memory-todo-storage.ts";
import { createTodoStore } from "./todo-store.ts";

describe("TodoStore 领域状态与生命周期", () => {
  it.skip("支持新增、勾选、改名（保留原 id）与删除，忽略空白文案或不存在的 id，且新 id 顺延已有最大值", () => {
    const storage = createMemoryTodoStorage({
      initialRaw: JSON.stringify([{ id: 10, text: "已有任务", completed: false }]),
    });

    createRoot((dispose) => {
      const store = createTodoStore(storage);
      expect(store.todos()).toEqual([{ id: 10, text: "已有任务", completed: false }]);

      // 空白文案不会新增任务，也不触发写入。
      store.addTodo("   ");
      expect(store.todos()).toHaveLength(1);
      expect(storage.getWriteCount()).toBe(0);

      // 新增任务应从已有最大 id 顺延递增，避免与历史记录撞键。
      store.addTodo("  实现 todo-store  ");
      store.addTodo("补齐单测");
      expect(store.todos()).toEqual([
        { id: 10, text: "已有任务", completed: false },
        { id: 11, text: "实现 todo-store", completed: false },
        { id: 12, text: "补齐单测", completed: false },
      ]);

      // 勾选与改名均保留原 id；不存在的 id 或空白改名被安全忽略。
      store.toggleTodo(11);
      store.updateTodo(11, "  重构 todo-store  ");
      store.updateTodo(11, "   ");
      store.toggleTodo(999);
      expect(store.todos()[1]).toEqual({ id: 11, text: "重构 todo-store", completed: true });

      store.removeTodo(12);
      store.removeTodo(999);
      expect(store.todos()).toEqual([
        { id: 10, text: "已有任务", completed: false },
        { id: 11, text: "重构 todo-store", completed: true },
      ]);

      dispose();
    });
  });

  it.skip("按筛选条件派生 visibleTodos，并与 remainingCount / completedCount / 惰性 completedDetails 保持一致", () => {
    const storage = createMemoryTodoStorage({
      initialRaw: JSON.stringify([
        { id: 1, text: "任务一", completed: true },
        { id: 2, text: "任务二", completed: false },
        { id: 3, text: "任务三", completed: false },
      ]),
    });

    createRoot((dispose) => {
      const store = createTodoStore(storage);

      expect(store.remainingCount()).toBe(2);
      expect(store.completedCount()).toBe(1);
      expect(store.completedDetails()).toBe("已完成明细：任务一");

      store.setFilter("active");
      expect(store.visibleTodos().map((todo) => todo.id)).toEqual([2, 3]);

      store.setFilter("completed");
      expect(store.visibleTodos().map((todo) => todo.id)).toEqual([1]);

      store.toggleTodo(2);
      expect(store.remainingCount()).toBe(1);
      expect(store.completedCount()).toBe(2);
      expect(store.visibleTodos().map((todo) => todo.id)).toEqual([1, 2]);
      expect(store.completedDetails()).toBe("已完成明细：任务一、任务二");

      dispose();
    });
  });

  it.skip("仅在任务实际变化时持久化：初始化、切换筛选、重复同文案改名与无效命令均不触发额外写入", () => {
    const storage = createMemoryTodoStorage({
      initialRaw: JSON.stringify([{ id: 1, text: "任务一", completed: false }]),
    });

    createRoot((dispose) => {
      const store = createTodoStore(storage);
      expect(storage.getWriteCount()).toBe(0);

      // 切换筛选、改名与原值相同、删除不存在项均不应写盘。
      store.setFilter("active");
      store.setFilter("completed");
      store.updateTodo(1, "  任务一  ");
      store.removeTodo(404);
      store.toggleTodo(404);
      expect(storage.getWriteCount()).toBe(0);

      // 实际新增一条任务时精确写入 1 次。
      store.addTodo("任务二");
      expect(storage.getWriteCount()).toBe(1);
      expect(storage.getRaw()).toContain("任务二");

      dispose();
    });
  });

  it.skip("写入失败时置位 saveError 并保留内存中的最新任务，存储恢复后再次修改自动保存并清除错误", () => {
    const storage = createMemoryTodoStorage({ initialRaw: "[]", failWrite: true });

    createRoot((dispose) => {
      const store = createTodoStore(storage);

      store.addTodo("离线任务");
      expect(store.todos()).toEqual([{ id: 1, text: "离线任务", completed: false }]);
      expect(store.saveError()).toBe(true);

      storage.setFailWrite(false);
      store.toggleTodo(1);
      expect(store.saveError()).toBe(false);
      expect(storage.getRaw()).toContain("离线任务");

      dispose();
    });
  });

  it.skip("遇到损坏数据或读取失败时保留降级警告且启动不覆写原存储", () => {
    const broken = createMemoryTodoStorage({ initialRaw: "{bad-json" });

    createRoot((dispose) => {
      const store = createTodoStore(broken);
      expect(store.todos().length).toBe(3);
      expect(store.loadWarning()).toContain("读取本地存储失败");
      expect(broken.getWriteCount()).toBe(0);
      expect(broken.getRaw()).toBe("{bad-json");
      dispose();
    });
  });

  it.skip("释放所属 createRoot 后，自动保存 effect 自动退订，再调用保留下来的 store 命令也不会触发写入", () => {
    const storage = createMemoryTodoStorage({ initialRaw: "[]" });

    const { store, dispose } = createRoot((disposeRoot) => ({
      store: createTodoStore(storage),
      dispose: disposeRoot,
    }));

    store.addTodo("释放前写入");
    expect(storage.getWriteCount()).toBe(1);

    // 释放创建 store 的 Owner：自动保存 effect 立刻退订。
    dispose();
    store.addTodo("释放后仅改信号，不再写盘");
    expect(storage.getWriteCount()).toBe(1);
  });
});
