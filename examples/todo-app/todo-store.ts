// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { createEffect, createMemo, createSignal, untrack } from "nano-solid";
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { loadTodosFromStorage, type TodoStorage } from "./storage.ts";
import type { Todo, TodoFilter } from "./types.ts";

/**
 * Todo 应用领域状态接口：向外暴露只读状态/派生 getter 与业务命令，隔离视图草稿、DOM 焦点与底层存储细节。
 */
export type TodoStore = {
  /** 当前全部任务列表。 */
  readonly todos: () => readonly Todo[];
  /** 按当前筛选条件过滤后的可见任务列表。 */
  readonly visibleTodos: () => readonly Todo[];
  /** 当前未完成任务数量。 */
  readonly remainingCount: () => number;
  /** 当前已完成任务数量。 */
  readonly completedCount: () => number;
  /** 按需（惰性）派生的已完成任务明细文案。 */
  readonly completedDetails: () => string;
  /** 当前筛选条件（all / active / completed）。 */
  readonly filter: () => TodoFilter;
  /** 启动恢复阶段的降级提示文案，无异常时为 null。 */
  readonly loadWarning: () => string | null;
  /** 最近一次写入存储是否失败。 */
  readonly saveError: () => boolean;
  /** 新增一条任务（自动 trim，空白文案忽略）。 */
  addTodo(text: string): void;
  /** 切换指定 id 任务的完成状态（不存在时忽略）。 */
  toggleTodo(id: number): void;
  /** 删除指定 id 的任务（不存在时忽略）。 */
  removeTodo(id: number): void;
  /** 更新指定 id 任务的标题（保留原 id；空白、不存在或文案未变时忽略）。 */
  updateTodo(id: number, text: string): void;
  /** 切换筛选条件（不会触发存储写入）。 */
  setFilter(next: TodoFilter): void;
};

/**
 * 在当前活跃的 Owner（浏览器里由 render 管理，单测里由 createRoot 管理）内创建 Todo 业务状态与自动保存副作用。
 *
 * @param storage 同步字符串存储适配器（浏览器 localStorage 或测试内存 fake）。
 * @returns 只读状态 getter 与业务命令组成的 TodoStore。
 */
export function createTodoStore(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  storage: TodoStorage,
): TodoStore {
  // 1. 从 storage 恢复初始任务与降级提示，初始化 todos / filter / loadWarning / saveError 信号与单调递增的 nextId。
  // 2. 用 createMemo 派生 visibleTodos、remainingCount、completedCount 与惰性 completedDetails。
  // 3. 用 createEffect 仅追踪 todos() 自动持久化（跳过首轮、untrack 调用 storage.write、try/catch 维护 saveError）。
  // 4. 返回只读 getter 与 addTodo / toggleTodo / removeTodo / updateTodo / setFilter 命令。
  // TODO: 实现 createTodoStore
  throw new Error("TODO: 实现 createTodoStore");
}
