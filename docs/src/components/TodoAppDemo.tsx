import { For, Show, createMemo, createSignal } from "solid-js";

/** 第七章 Todo 应用演示组件的输入属性。 */
export type TodoAppDemoProps = {
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 筛选条件枚举：全部、未完成或已完成。 */
type TodoFilter = "all" | "active" | "completed";

/** 单条待办任务数据结构。 */
type Todo = {
  id: number;
  text: string;
  completed: boolean;
};

/** 演示列表的初始待办任务。 */
const INITIAL_TODOS: Todo[] = [
  { id: 1, text: "实现 createMemo 派生缓存", completed: true },
  { id: 2, text: "实现按 key 复用的 For 列表", completed: false },
  { id: 3, text: "补齐表单输入与行内编辑", completed: false },
];

/**
 * 用真正的 SolidJS 驱动第七章终点效果：新增任务、勾选完成、Show 行内编辑以及 createMemo 筛选统计。
 *
 * @param props 无障碍说明。
 * @returns 复用共享 .ns-* 样式的交互 Todo 演示卡片。
 */
export default function TodoAppDemo(props: TodoAppDemoProps) {
  // 1. 定义任务列表、筛选条件、新建输入框草稿与行内编辑状态。
  const [todos, setTodos] = createSignal<Todo[]>(INITIAL_TODOS);
  const [filter, setFilter] = createSignal<TodoFilter>("all");
  const [draft, setDraft] = createSignal("");
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editDraft, setEditDraft] = createSignal("");

  let nextId = INITIAL_TODOS.length + 1;
  let composerInput: HTMLInputElement | undefined;

  // 2. 用 createMemo 派生当前筛选结果与未完成、已完成数量，避免重复遍历。
  const visibleTodos = createMemo(() => {
    const currentFilter = filter();
    const list = todos();
    if (currentFilter === "active") return list.filter((todo) => !todo.completed);
    if (currentFilter === "completed") return list.filter((todo) => todo.completed);
    return list;
  });

  const remainingCount = createMemo(() => todos().filter((todo) => !todo.completed).length);
  const completedCount = createMemo(() => todos().length - remainingCount());

  /** 添加一条新任务，清空输入框并重新聚焦便于连续输入。 */
  const addTodo = () => {
    const text = draft().trim();
    if (!text) return;
    const id = nextId;
    nextId += 1;
    setTodos((list) => [...list, { id, text, completed: false }]);
    setDraft("");
    composerInput?.focus();
  };

  /** 切换指定任务的完成状态（不可变更新，保留原 id）。 */
  const toggleTodo = (id: number) => {
    setTodos((list) =>
      list.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
    );
  };

  /** 删除指定任务；若正在编辑该任务则顺带退出编辑态。 */
  const removeTodo = (id: number) => {
    setTodos((list) => list.filter((todo) => todo.id !== id));
    if (editingId() === id) {
      setEditingId(null);
    }
  };

  /** 进入指定任务的行内编辑态。 */
  const startEdit = (todo: Todo) => {
    setEditDraft(todo.text);
    setEditingId(todo.id);
  };

  /** 保存行内编辑结果并退出编辑态。 */
  const saveEdit = () => {
    const id = editingId();
    const text = editDraft().trim();
    if (id === null || !text) return;
    setTodos((list) => list.map((todo) => (todo.id === id ? { ...todo, text } : todo)));
    setEditingId(null);
  };

  /** 放弃行内编辑并恢复查看态。 */
  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <section class="ns-card dom-demo" aria-label={props.label ?? "Todo 应用预期效果演示"}>
      {/* 3. 顶部标题与由 createMemo 驱动的剩余未完成状态徽章。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">nano-solid Todo</h3>
        <span class={remainingCount() > 0 ? "ns-badge" : "ns-badge ns-badge-muted"}>
          {remainingCount() === 0 ? "全部完成" : `剩余 ${remainingCount()} 项`}
        </span>
      </div>

      {/* 4. 新建任务输入栏：受控 value、onInput 与提交后 ref 聚焦。 */}
      <div class="ns-todo-composer">
        <input
          ref={(element) => {
            composerInput = element;
          }}
          type="text"
          class="ns-input"
          placeholder="输入待办事项..."
          aria-label="新建待办事项"
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <button
          type="button"
          class="ns-btn"
          disabled={draft().trim().length === 0}
          onClick={addTodo}
        >
          添加
        </button>
      </div>

      {/* 5. 筛选切换栏：驱动 createMemo 重新计算 visibleTodos。 */}
      <div class="ns-actions ns-todo-filters">
        <button
          type="button"
          class={filter() === "all" ? "ns-btn ns-btn-active" : "ns-btn"}
          onClick={() => setFilter("all")}
        >
          全部
        </button>
        <button
          type="button"
          class={filter() === "active" ? "ns-btn ns-btn-active" : "ns-btn"}
          onClick={() => setFilter("active")}
        >
          未完成
        </button>
        <button
          type="button"
          class={filter() === "completed" ? "ns-btn ns-btn-active" : "ns-btn"}
          onClick={() => setFilter("completed")}
        >
          已完成
        </button>
      </div>

      {/* 6. 任务列表：外层用 <For> 渲染筛选结果，每行内用 <Show> 在查看态与编辑态之间切换。 */}
      <ul class="ns-list">
        <For each={visibleTodos()} fallback={<p class="ns-empty">当前筛选下没有待办事项。</p>}>
          {(todo) => (
            <li class="ns-list-item">
              <Show
                when={editingId() === todo.id}
                fallback={
                  <>
                    <input
                      type="checkbox"
                      class="ns-checkbox"
                      aria-label={todo.completed ? "标为未完成" : "标为已完成"}
                      checked={todo.completed}
                      onChange={() => toggleTodo(todo.id)}
                    />
                    <span
                      class={todo.completed ? "ns-todo-text ns-todo-text-done" : "ns-todo-text"}
                    >
                      {todo.text}
                    </span>
                    <button type="button" class="ns-btn ns-btn-sm" onClick={() => startEdit(todo)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      class="ns-btn ns-btn-sm ns-btn-danger"
                      onClick={() => removeTodo(todo.id)}
                    >
                      删除
                    </button>
                  </>
                }
              >
                <input
                  type="text"
                  class="ns-input"
                  aria-label="编辑待办事项"
                  value={editDraft()}
                  onInput={(event) => setEditDraft(event.currentTarget.value)}
                />
                <button
                  type="button"
                  class="ns-btn ns-btn-sm"
                  disabled={editDraft().trim().length === 0}
                  onClick={saveEdit}
                >
                  保存
                </button>
                <button type="button" class="ns-btn ns-btn-sm" onClick={cancelEdit}>
                  取消
                </button>
              </Show>
            </li>
          )}
        </For>
      </ul>

      {/* 7. 底部统计行：由 createMemo 派生总条数、当前可见数与已完成数。 */}
      <p class="ns-meta">
        共 <code>{todos().length}</code> 项，当前显示 <code>{visibleTodos().length}</code>{" "}
        项，已完成 <code>{completedCount()}</code> 项
      </p>
    </section>
  );
}
