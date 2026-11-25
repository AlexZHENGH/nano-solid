import { For, batch, createSignal } from "nano-solid";
import type { Todo } from "../types.ts";
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
export function TodoList(props: TodoListProps): Node {
  // 维护局部 editingId 与 editDraft 信号，用 <For each={props.todos} getKey={(todo) => todo.id}> 渲染 <TodoItem /> 与空列表 fallback。
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editDraft, setEditDraft] = createSignal("");

  /** 进入指定任务的行内编辑态并回填当前文案。 */
  const startEdit = (todo: Todo) => {
    batch(() => {
      setEditDraft(todo.text);
      setEditingId(todo.id);
    });
  };

  /** 保存行内编辑并退出编辑态。 */
  const saveEdit = () => {
    const id = editingId();
    const text = editDraft().trim();
    if (id === null || !text) return;
    batch(() => {
      props.onUpdate(id, text);
      setEditingId(null);
    });
  };

  /** 放弃行内编辑并恢复查看态。 */
  const cancelEdit = () => {
    setEditingId(null);
  };

  /** 删除指定任务；若正在编辑该任务则用 batch 同步退出编辑态。 */
  const removeTodo = (id: number) => {
    batch(() => {
      props.onRemove(id);
      if (editingId() === id) {
        setEditingId(null);
      }
    });
  };

  return (
    <ul class="ns-list">
      <For
        each={props.todos}
        getKey={(todo) => todo.id}
        fallback={() => <p class="ns-empty">当前筛选下没有待办事项。</p>}
      >
        {(todo) => (
          <TodoItem
            todo={todo}
            isEditing={() => editingId() === todo().id}
            editDraft={editDraft}
            onToggle={props.onToggle}
            onStartEdit={startEdit}
            onChangeEditDraft={setEditDraft}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onRemove={removeTodo}
          />
        )}
      </For>
    </ul>
  );
}
