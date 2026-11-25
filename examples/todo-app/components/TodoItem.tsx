// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { Show } from "nano-solid";
import type { Todo } from "../types.ts";

/** 单条任务行组件的输入属性。 */
export type TodoItemProps = {
  /** 当前行的响应式任务 getter，确保 <For> 复用同一个 <li> 并原地更新内容。 */
  todo: () => Todo;
  /** 当前行是否处于行内编辑态。 */
  isEditing: () => boolean;
  /** 行内编辑输入框草稿。 */
  editDraft: () => string;
  /** 切换完成状态回调。 */
  onToggle: (id: number) => void;
  /** 进入编辑态回调。 */
  onStartEdit: (todo: Todo) => void;
  /** 编辑草稿输入变更回调。 */
  onChangeEditDraft: (next: string) => void;
  /** 保存编辑回调。 */
  onSaveEdit: () => void;
  /** 取消编辑回调。 */
  onCancelEdit: () => void;
  /** 删除当前行回调。 */
  onRemove: (id: number) => void;
};

/**
 * 单条待办任务行组件：通过 <Show> 在查看态（复选框、文案、编辑/删除）与行内编辑态之间切换。
 *
 * @param props 响应式任务 getter 与行级交互回调。
 * @returns 单个 <li> 节点。
 */
export function TodoItem(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  props: TodoItemProps,
): Node {
  // 渲染 <li id={`todo-${props.todo().id}`}>，内部用 <Show when={props.isEditing}> 切换查看态与编辑态分支。
  // TODO: 实现 TodoItem
  throw new Error("TODO: 实现 TodoItem");
}
