import { For, Show, createEffect, createSignal, onMount } from "solid-js";

/** 第十一章持久化与故障降级演示组件的输入属性。 */
export type PersistentTodoDemoProps = {
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 单条待办任务数据结构。 */
type Todo = {
  id: number;
  text: string;
  completed: boolean;
};

/** 演示专用的 localStorage 存储键，与示例应用本身隔离。 */
const DEMO_STORAGE_KEY = "nano-solid:docs-demo-11.0:todos";

/** 初始示例待办任务。 */
const INITIAL_TODOS: Todo[] = [
  { id: 1, text: "把任务保存到 localStorage", completed: true },
  { id: 2, text: "校验坏数据并降级提示", completed: false },
  { id: 3, text: "抽离 todo-store 与子组件", completed: false },
];

/** 故障演示使用的部分损坏 JSON 样本（2 条合法 + 1 条缺字段 + 1 条重复 ID）。 */
const CORRUPTED_RAW = JSON.stringify([
  { id: 1, text: "保住的合法任务 A", completed: true },
  { id: 2, text: "保住的合法任务 B", completed: false },
  { id: -5, text: "非法负数 ID（会被跳过）", completed: false },
  { id: 2, text: "重复 ID 2（会被跳过）", completed: true },
]);

/** 逐项校验原始 JSON 字符串，合法项保留首条并统计跳过条数。 */
function parseDemoTodos(raw: string): { todos: Todo[]; skipped: number } {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected array");
  }
  const seenIds = new Set<number>();
  const todos: Todo[] = [];
  let skipped = 0;

  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).id === "number" &&
      Number.isSafeInteger((item as Record<string, unknown>).id) &&
      ((item as Record<string, unknown>).id as number) > 0 &&
      typeof (item as Record<string, unknown>).text === "string" &&
      typeof (item as Record<string, unknown>).completed === "boolean"
    ) {
      const candidate = item as Todo;
      if (seenIds.has(candidate.id)) {
        skipped += 1;
        continue;
      }
      seenIds.add(candidate.id);
      todos.push({ id: candidate.id, text: candidate.text, completed: candidate.completed });
    } else {
      skipped += 1;
    }
  }

  return { todos, skipped };
}

/** 内部挂载实例：每次点击“重新打开演示”会真实卸载再重新挂载，从 localStorage 重新恢复状态。 */
function LivePersistentPanel(props: { epoch: number }) {
  const [todos, setTodos] = createSignal<Todo[]>(INITIAL_TODOS);
  const [draft, setDraft] = createSignal("");
  const [hydrated, setHydrated] = createSignal(false);

  // 1. 仅在浏览器挂载后读取 localStorage，避免静态站点构建（SSR）阶段访问 window。
  onMount(() => {
    try {
      const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw !== null) {
        const result = parseDemoTodos(raw);
        setTodos(result.todos);
      }
    } catch {
      setTodos(INITIAL_TODOS);
    }
    setHydrated(true);
  });

  // 2. 完成首轮恢复后，仅在 todos 变化时写入 localStorage；输入草稿不会触发保存。
  let firstPersist = true;
  createEffect(() => {
    const current = todos();
    if (!hydrated()) return;
    if (firstPersist) {
      firstPersist = false;
      return;
    }
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // 演示区忽略隐身模式等存储受限报错。
    }
  });

  const addTodo = () => {
    const text = draft().trim();
    if (!text) return;
    const nextId = Math.max(0, ...todos().map((todo) => todo.id)) + 1;
    setTodos((list) => [...list, { id: nextId, text, completed: false }]);
    setDraft("");
  };

  const toggleTodo = (id: number) => {
    setTodos((list) =>
      list.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
    );
  };

  return (
    <div>
      <div class="ns-todo-composer">
        <input
          type="text"
          class="ns-input"
          placeholder="输入任务并添加，然后点下方重新打开..."
          aria-label="持久化演示新任务"
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

      <ul class="ns-list">
        <For each={todos()}>
          {(todo) => (
            <li class="ns-list-item">
              <div class="ns-todo-row">
                <input
                  type="checkbox"
                  class="ns-checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                />
                <span class={todo.completed ? "ns-todo-text ns-todo-text-done" : "ns-todo-text"}>
                  {todo.text}
                </span>
              </div>
            </li>
          )}
        </For>
      </ul>

      <p class="ns-meta">
        当前挂载轮次：<code>#{props.epoch}</code>（重新打开会真实卸载组件并重读{" "}
        <code>localStorage</code>，任务保留，草稿清空）
      </p>
    </div>
  );
}

/**
 * 第十一章总览交互演示：上半部分用真实 localStorage 演示卸载重挂载后的状态恢复，
 * 下半部分用独立内存 fake 演示坏数据部分恢复与写入失败降级提示。
 *
 * @param props 无障碍说明。
 * @returns 包含持久化体验与故障降级体验的交互卡片。
 */
export default function PersistentTodoDemo(props: PersistentTodoDemoProps) {
  // 1. 正常持久化演示的挂载轮次：递增即触发 <Show keyed> 卸载并重新挂载。
  const [epoch, setEpoch] = createSignal(1);

  /** 清空演示专用的 localStorage 键并重新挂载。 */
  const resetLiveStorage = () => {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {
      // 忽略受限环境异常。
    }
    setEpoch((current) => current + 1);
  };

  // 2. 独立故障演练区状态（使用内存模拟，不污染上方真实 localStorage 数据）。
  const [faultMode, setFaultMode] = createSignal<"none" | "corrupted" | "write-fail">("none");
  const [faultTodos, setFaultTodos] = createSignal<Todo[]>([]);
  const [faultBanner, setFaultBanner] = createSignal<{
    kind: "warn" | "danger";
    text: string;
  } | null>(null);
  const [writeBlocked, setWriteBlocked] = createSignal(false);
  let faultNextId = 10;

  /** 场景 A：载入含非法记录与重复 ID 的损坏 JSON，展示逐项校验与部分恢复。 */
  const triggerCorruptedLoad = () => {
    const result = parseDemoTodos(CORRUPTED_RAW);
    setFaultMode("corrupted");
    setWriteBlocked(false);
    setFaultTodos(result.todos);
    setFaultBanner({
      kind: "warn",
      text: `检测到损坏的本地记录：已救回 ${result.todos.length} 条有效任务，跳过 ${result.skipped} 条非法或重复项。`,
    });
  };

  /** 场景 B：模拟存储配额已满导致写入抛错，再允许恢复存储重试保存。 */
  const triggerWriteFailure = () => {
    setFaultMode("write-fail");
    setWriteBlocked(true);
    setFaultTodos([
      { id: 1, text: "已有任务（本地已保存）", completed: true },
      { id: 2, text: "刚新增的任务（当前仅在内存中）", completed: false },
    ]);
    setFaultBanner({
      kind: "danger",
      text: "保存失败：本地存储写入抛错，本次改动已保留在页面中，请稍后重试。",
    });
  };

  /** 写入失败演练中：模拟存储恢复，新增一条任务成功保存并自动撤下红色警报。 */
  const recoverAndSave = () => {
    faultNextId += 1;
    setWriteBlocked(false);
    setFaultTodos((list) => [
      ...list,
      { id: faultNextId, text: "存储恢复后新增并保存成功", completed: false },
    ]);
    setFaultBanner(null);
  };

  return (
    <section
      class="ns-card dom-demo"
      aria-label={props.label ?? "第十一章预期效果：Todo 持久化与故障降级演示"}
    >
      {/* 上半区：真实 localStorage 持久化与模拟刷新。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">本地持久化演示（真实 localStorage）</h3>
        <div class="ns-actions">
          <button
            type="button"
            class="ns-btn ns-btn-sm ns-btn-active"
            onClick={() => setEpoch((current) => current + 1)}
          >
            重新打开演示
          </button>
          <button type="button" class="ns-btn ns-btn-sm" onClick={resetLiveStorage}>
            重置存储
          </button>
        </div>
      </div>

      <Show when={epoch()} keyed>
        {(currentEpoch) => <LivePersistentPanel epoch={currentEpoch} />}
      </Show>

      <hr class="ns-divider" />

      {/* 下半区：独立内存 fake 故障演练区。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">故障降级演练（独立内存 Fake）</h3>
        <div class="ns-actions">
          <button
            type="button"
            class={
              faultMode() === "corrupted" ? "ns-btn ns-btn-sm ns-btn-active" : "ns-btn ns-btn-sm"
            }
            onClick={triggerCorruptedLoad}
          >
            注入损坏数据
          </button>
          <button
            type="button"
            class={
              faultMode() === "write-fail" ? "ns-btn ns-btn-sm ns-btn-active" : "ns-btn ns-btn-sm"
            }
            onClick={triggerWriteFailure}
          >
            模拟保存失败
          </button>
        </div>
      </div>

      <Show when={faultBanner()}>
        {(banner) => (
          <p
            class={
              banner().kind === "warn" ? "ns-banner ns-banner-warn" : "ns-banner ns-banner-danger"
            }
          >
            {banner().text}
          </p>
        )}
      </Show>

      <Show
        when={faultMode() !== "none"}
        fallback={
          <p class="ns-meta">
            点击上方按钮，体验读到损坏数据时的部分恢复提示，或写入抛错时的降级保留与恢复。
          </p>
        }
      >
        <ul class="ns-list">
          <For each={faultTodos()}>
            {(todo) => (
              <li class="ns-list-item">
                <span class={todo.completed ? "ns-todo-text ns-todo-text-done" : "ns-todo-text"}>
                  #{todo.id} {todo.text}
                </span>
              </li>
            )}
          </For>
        </ul>
        <Show when={writeBlocked()}>
          <button type="button" class="ns-btn ns-btn-sm" onClick={recoverAndSave}>
            恢复存储并再次新增保存
          </button>
        </Show>
      </Show>
    </section>
  );
}
