import {
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  For,
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  Show,
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  createMemo,
  createSignal,
} from "#nano-solid";

/** 筛选条件枚举：全部、未完成或已完成。 */
export type TodoFilter = "all" | "active" | "completed";

/** 单条待办任务数据结构。 */
export type Todo = {
  id: number;
  text: string;
  completed: boolean;
};

/** 初始示例待办任务。 */
export const INITIAL_TODOS: Todo[] = [
  { id: 1, text: "实现 createMemo 派生缓存", completed: true },
  { id: 2, text: "实现按 key 复用的 For 列表", completed: false },
  { id: 3, text: "补齐表单输入与行内编辑", completed: false },
];

/**
 * Todo 示例应用根组件：组合 createSignal、createMemo、<For>、<Show> 与受控表单，完成新增、勾选、筛选与行内编辑。
 *
 * @returns 完整 Todo 卡片的原生 DOM 节点。
 */
export function App(): Node {
  // 1. 定义任务列表、当前筛选条件、新建输入框草稿与行内编辑状态。
  const [todos, setTodos] = createSignal<Todo[]>(INITIAL_TODOS);
  const [filter, setFilter] = createSignal<TodoFilter>("all");
  const [draft, setDraft] = createSignal("");
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editDraft, setEditDraft] = createSignal("");

  let nextId = INITIAL_TODOS.length + 1;
  let composerInput: HTMLInputElement | undefined;

  // 2. 用 createMemo 派生筛选后的可见列表与未完成、已完成数量，避免多处读取重复遍历。
  // TODO: 用 createMemo 按 filter() ("all" / "active" / "completed") 过滤 todos()，并用 createMemo 统计 remainingCount 与 completedCount。
  const visibleTodos = () => todos();
  const remainingCount = () => 0;
  const completedCount = () => 0;

  /** 添加一条新任务，清空草稿并把焦点放回新建输入框。 */
  const addTodo = () => {
    const text = draft().trim();
    if (!text) return;
    const id = nextId;
    nextId += 1;
    setTodos([...todos(), { id, text, completed: false }]);
    setDraft("");
    composerInput?.focus();
  };

  /** 切换指定任务的完成状态（不可变更新，保留原 id 以便 <For> 原地复用行节点）。 */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const toggleTodo = (id: number) => {
    setTodos(
      todos().map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
    );
  };

  /** 删除指定任务；若正在编辑该任务则同步退出编辑态。 */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const removeTodo = (id: number) => {
    setTodos(todos().filter((todo) => todo.id !== id));
    if (editingId() === id) {
      setEditingId(null);
    }
  };

  /** 进入指定任务的行内编辑态并回填当前文案。 */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const startEdit = (todo: Todo) => {
    setEditDraft(todo.text);
    setEditingId(todo.id);
  };

  /** 保存行内编辑结果并退出编辑态。 */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const saveEdit = () => {
    const id = editingId();
    const text = editDraft().trim();
    if (id === null || !text) return;
    setTodos(todos().map((todo) => (todo.id === id ? { ...todo, text } : todo)));
    setEditingId(null);
  };

  /** 放弃行内编辑并恢复查看态。 */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const cancelEdit = () => {
    setEditingId(null);
  };

  // 3. 拼装 Todo 卡片界面：头部状态徽章、新建栏、筛选栏、任务列表与底部统计。
  return (
    <section class="ns-card">
      <div class="ns-card-header">
        <h1 class="ns-card-title">nano-solid Todo</h1>
        <span
          id="remaining-badge"
          class={() => (remainingCount() > 0 ? "ns-badge" : "ns-badge ns-badge-muted")}
        >
          {() => (remainingCount() === 0 ? "全部完成" : `剩余 ${remainingCount()} 项`)}
        </span>
      </div>

      {/* 新建任务输入栏：受控 value、onInput 与提交后 ref 自动聚焦。 */}
      <div class="ns-todo-composer">
        <input
          id="todo-input"
          type="text"
          class="ns-input"
          placeholder="输入待办事项..."
          aria-label="新建待办事项"
          ref={(element) => {
            composerInput = element;
          }}
          value={() => draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <button
          id="add-todo"
          type="button"
          class="ns-btn"
          disabled={() => draft().trim().length === 0}
          onClick={addTodo}
        >
          添加
        </button>
      </div>

      {/* 筛选切换栏：驱动 createMemo 重新计算 visibleTodos。 */}
      <div class="ns-actions ns-todo-filters">
        <button
          id="filter-all"
          type="button"
          class={() => (filter() === "all" ? "ns-btn ns-btn-active" : "ns-btn")}
          onClick={() => setFilter("all")}
        >
          全部
        </button>
        <button
          id="filter-active"
          type="button"
          class={() => (filter() === "active" ? "ns-btn ns-btn-active" : "ns-btn")}
          onClick={() => setFilter("active")}
        >
          未完成
        </button>
        <button
          id="filter-completed"
          type="button"
          class={() => (filter() === "completed" ? "ns-btn ns-btn-active" : "ns-btn")}
          onClick={() => setFilter("completed")}
        >
          已完成
        </button>
      </div>

      {/* 任务列表：外层用 <For> 按 todo.id 复用行节点，每行内用 <Show> 切换查看态与行内编辑态。 */}
      <ul class="ns-list">
        {/* TODO: 用 <For each={visibleTodos} getKey={(todo) => todo.id} fallback={() => <p class="ns-empty">当前筛选下没有待办事项。</p>}> 渲染每一条任务，并在 <li id={`todo-${todo().id}`} class="ns-list-item"> 内用 <Show when={() => editingId() === todo().id}> 切换查看态（复选框、文本、编辑、删除）与编辑态（输入框、保存、取消）。 */}
      </ul>

      {/* 底部统计行：展示总条数、当前可见条数与已完成条数。 */}
      <p id="todo-stats" class="ns-meta">
        共 <code>{() => todos().length}</code> 项，当前显示{" "}
        <code>{() => visibleTodos().length}</code> 项，已完成 <code>{() => completedCount()}</code>{" "}
        项
      </p>
    </section>
  );
}
