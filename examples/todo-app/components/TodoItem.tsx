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
export function TodoItem(props: TodoItemProps): Node {
  // 渲染 <li id={`todo-${props.todo().id}`}>，内部用 <Show when={props.isEditing}> 切换查看态与编辑态分支。
  return (
    <li id={`todo-${props.todo().id}`} class="ns-list-item">
      <Show
        when={props.isEditing}
        fallback={() => (
          // 查看态分支：所有动态字段都留在 () => props.todo().xxx 中读取，保证原地细粒度更新。
          <div class="ns-todo-row">
            <input
              type="checkbox"
              class="ns-checkbox"
              aria-label={() => (props.todo().completed ? "标为未完成" : "标为已完成")}
              checked={() => props.todo().completed}
              onChange={() => props.onToggle(props.todo().id)}
            />
            <span
              class={() =>
                props.todo().completed ? "ns-todo-text ns-todo-text-done" : "ns-todo-text"
              }
            >
              {() => props.todo().text}
            </span>
            <button
              type="button"
              class="ns-btn ns-btn-sm"
              onClick={() => props.onStartEdit(props.todo())}
            >
              编辑
            </button>
            <button
              type="button"
              class="ns-btn ns-btn-sm ns-btn-danger"
              onClick={() => props.onRemove(props.todo().id)}
            >
              删除
            </button>
          </div>
        )}
      >
        {() => (
          // 行内编辑态分支：绑定受控编辑输入框，空白时自动禁用保存按钮。
          <div class="ns-todo-row">
            <input
              type="text"
              class="ns-input"
              aria-label="编辑待办事项"
              value={() => props.editDraft()}
              onInput={(event) => props.onChangeEditDraft(event.currentTarget.value)}
            />
            <button
              type="button"
              class="ns-btn ns-btn-sm"
              disabled={() => props.editDraft().trim().length === 0}
              onClick={props.onSaveEdit}
            >
              保存
            </button>
            <button type="button" class="ns-btn ns-btn-sm" onClick={props.onCancelEdit}>
              取消
            </button>
          </div>
        )}
      </Show>
    </li>
  );
}
