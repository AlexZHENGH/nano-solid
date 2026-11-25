import { createEffect, createSignal, untrack } from "nano-solid";
import { loadTodosFromStorage, type TodoStorage } from "./storage.ts";
import { createTodoModel, type TodoModel } from "./todo-model.ts";

/** 视图使用的任务模型，以及保存失败和启动恢复的提示。 */
export type TodoStore = TodoModel & {
  /** 启动恢复阶段的降级提示文案，无异常时为 null。 */
  readonly loadWarning: () => string | null;
  /** 最近一次写入存储是否失败。 */
  readonly saveError: () => boolean;
};

/**
 * 从同步存储启动 Todo，并在当前 Owner 内登记自动保存。
 * @param storage 浏览器本地存储或测试替身。
 * @returns App 使用的任务模型和持久化状态。
 */
export function createTodoStore(storage: TodoStorage): TodoStore {
  // 先恢复数据，再建立模型，避免把临时空列表写回存储。
  const initial = loadTodosFromStorage(storage);
  const { model } = createTodoModel(initial.todos);
  const [loadWarning] = createSignal(initial.warning);
  const [saveError, setSaveError] = createSignal(false);

  // 跳过刚恢复的快照。此后只追踪任务列表，筛选和提示状态不会引发写入。
  let isFirstPersistRun = true;
  createEffect(() => {
    const currentTodos = model.todos();
    if (isFirstPersistRun) {
      isFirstPersistRun = false;
      return;
    }
    try {
      untrack(() => {
        storage.write(JSON.stringify(currentTodos));
      });
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  });

  return { ...model, loadWarning, saveError };
}
