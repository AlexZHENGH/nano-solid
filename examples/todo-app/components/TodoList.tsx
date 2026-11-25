// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { For, batch, createSignal } from "nano-solid";
import type { Todo } from "../types.ts";
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { TodoItem } from "./TodoItem.tsx";

/** 任务列表组件的输入属性。 */
export type TodoListProps = {
  /** 当前可见任务列表 getter。 */
  todos: () => readonly Todo[];
  /** 切换任务完成状态回调。 */
  onToggle: (id: number) => void;
  /** 保存任务改名回调。 */
  onUpdate: (id: number, text: string) => void;
  /** 删除任务回调。 */
  onRemove: (id: number) => void;
};

/**
 * 任务列表容器组件：维护行内编辑的局部视图状态（editingId / editDraft），用 <For> 按 id 复用每个 <TodoItem />。
 *
 * @param props 可见任务列表与业务回调。
 * @returns <ul> 列表节点。
 */
export function TodoList(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  props: TodoListProps,
): Node {
  // 维护局部 editingId 与 editDraft 信号，用 <For each={props.todos} getKey={(todo) => todo.id}> 渲染 <TodoItem /> 与空列表 fallback。
  // TODO: 实现 TodoList
  throw new Error("TODO: 实现 TodoList");
}
