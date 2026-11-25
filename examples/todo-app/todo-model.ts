import { batch, createMemo, createSignal } from "nano-solid";
import type { Todo, TodoFilter } from "./types.ts";

/** 同步和异步 Store 共用的只读状态与编辑命令。 */
export type TodoModel = {
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
 * 管理任务和派生值，让两个 Store 复用同一套编辑规则。
 * @param initial 开始时显示的任务快照。
 * @param onChange 仅在编辑产生新快照时触发的回调，可用于提交保存。
 * @returns 视图使用的模型，以及从仓库恢复数据的入口。
 */
export function createTodoModel(
  initial: readonly Todo[],
  onChange?: (snapshot: readonly Todo[]) => void,
): { model: TodoModel; restoreTodos: (snapshot: readonly Todo[]) => void } {
  // 从加载结果里顺延编号。筛选只影响视图，不会产生新的保存快照。
  const [todos, setTodos] = createSignal(initial);
  const [filter, setFilter] = createSignal<TodoFilter>("all");
  let nextId = Math.max(0, ...initial.map((todo) => todo.id)) + 1;

  // 列表、数量和明细根据任务状态派生，调用方可以复用计算结果。
  const visibleTodos = createMemo(() => {
    const currentFilter = filter();
    const list = todos();
    if (currentFilter === "active") return list.filter((todo) => !todo.completed);
    if (currentFilter === "completed") return list.filter((todo) => todo.completed);
    return list;
  });

  const remainingCount = createMemo(() => todos().filter((todo) => !todo.completed).length);
  const completedCount = createMemo(() => todos().length - remainingCount());

  const completedDetails = createMemo(
    () => {
      const done = todos().filter((todo) => todo.completed);
      return done.length === 0
        ? "暂无已完成任务。"
        : `已完成明细：${done.map((todo) => todo.text).join("、")}`;
    },
    { lazy: true },
  );

  /**
   * 把仓库快照装入模型，并从最大编号继续分配新任务。
   * @param snapshot 仓库已经持有的快照，不触发编辑回调。
   */
  function restoreTodos(snapshot: readonly Todo[]): void {
    nextId = Math.max(0, ...snapshot.map((todo) => todo.id)) + 1;
    setTodos(snapshot);
  }

  /**
   * 提交一次真正的编辑，让界面和保存端看到同一份快照。
   * @param next 编辑之后的新列表。
   */
  function commit(next: readonly Todo[]): void {
    // 更新列表和登记保存一起完成，订阅者看见新列表时它已经排上保存。
    batch(() => {
      setTodos(next);
      onChange?.(next);
    });
  }

  /** 清理输入后分配未使用过的任务编号。 */
  const addTodo = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = nextId;
    nextId += 1;
    commit([...todos(), { id, text: trimmed, completed: false }]);
  };

  /** 复用其他条目，只替换被勾选的任务。 */
  const toggleTodo = (id: number): void => {
    const current = todos();
    if (!current.some((todo) => todo.id === id)) return;
    commit(
      current.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
    );
  };

  /** 只有存在的任务会产生一个新的列表快照。 */
  const removeTodo = (id: number): void => {
    const current = todos();
    if (!current.some((todo) => todo.id === id)) return;
    commit(current.filter((todo) => todo.id !== id));
  };

  /** 保留任务编号，只在标题发生实际变化时提交。 */
  const updateTodo = (id: number, text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = todos();
    const target = current.find((todo) => todo.id === id);
    if (!target || target.text === trimmed) return;
    commit(current.map((todo) => (todo.id === id ? { ...todo, text: trimmed } : todo)));
  };

  return {
    model: {
      todos,
      visibleTodos,
      remainingCount,
      completedCount,
      completedDetails,
      filter,
      addTodo,
      toggleTodo,
      removeTodo,
      updateTodo,
      setFilter,
    },
    restoreTodos,
  };
}
