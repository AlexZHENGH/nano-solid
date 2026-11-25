import { Index, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import "./async-todo-demo.css";

/** 任务每次修改都会产生一个新版本，便于对照服务器确认的快照。 */
type Todo = { id: number; text: string; completed: boolean; revision: number };

/** 模拟服务器在第一次打开应用前已经保存的任务。 */
const INITIAL_TODOS: readonly Todo[] = [
  { id: 1, text: "订会议室", completed: false, revision: 0 },
  { id: 2, text: "发出会议邀请", completed: true, revision: 0 },
];

/** 把服务器上的快照与每次打开应用所需的信息交给面板。 */
type TodoPanelProps = {
  /** 读取服务器上最后确认的任务列表。 */
  confirmedTodos: () => readonly Todo[];
  /** 保存完成后，把这次发送的快照交给服务器。 */
  onConfirm: (snapshot: readonly Todo[]) => void;
  /** 上次关闭时丢弃了多少项未确认的任务修改。 */
  discardedCount: number;
  /** 带着当前待同步数量重新打开应用。 */
  onReopen: (pendingCount: number) => void;
};

/**
 * 一次打开应用所创建的面板，负责本地任务、草稿和计时器。
 * @param props 模拟服务器的读写接口和重开时所需的信息。
 * @returns 加载占位或可继续编辑的 Todo 列表。
 */
function TodoPanel(props: TodoPanelProps) {
  // 本地列表在读取完成前为空缺。编辑产生新快照，旧快照仍可交给正在保存的请求。
  const [todos, setTodos] = createSignal<readonly Todo[]>();
  const [draft, setDraft] = createSignal("");
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 判断当前任务版本是否还在等待服务器确认。
   * @param todo 界面正在显示的任务。
   * @returns 服务器还没有确认这条任务的当前版本时为 true。
   */
  function isPending(todo: Todo): boolean {
    return props.confirmedTodos().find((saved) => saved.id === todo.id)?.revision !== todo.revision;
  }

  // 行内提示和顶部数量都比较同一份已确认快照，旧版本的确认只影响它实际保存的版本。
  const pendingCount = createMemo(() => todos()?.filter(isPending).length ?? 0);

  /** 只在上一份快照完成后发下一份，本地列表一直保留最新的待保存内容。 */
  function saveNext(): void {
    const snapshot = todos();
    if (saveTimer !== undefined || snapshot === undefined || pendingCount() === 0) return;

    // 模拟服务器在计时结束时写入并确认开始保存时捕获的快照。
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      props.onConfirm(snapshot);
      saveNext();
    }, 2500);
  }

  /** 新任务立即出现在列表上，然后才开始等待服务器确认。 */
  function addTodo(): void {
    const current = todos();
    const text = draft().trim();
    if (!current || !text) return;
    const id = Math.max(0, ...current.map((todo) => todo.id)) + 1;
    setTodos([...current, { id, text, completed: false, revision: 0 }]);
    setDraft("");
    saveNext();
  }

  /**
   * 勾选时只更新这一行，后续确认旧快照时仍能认出它的最新版本。
   * @param id 当前勾选的任务编号。
   * @param completed 复选框的新值。
   */
  function toggleTodo(id: number, completed: boolean): void {
    setTodos((current) =>
      current?.map((todo) =>
        todo.id === id ? { ...todo, completed, revision: todo.revision + 1 } : todo,
      ),
    );
    saveNext();
  }

  // 每个新面板都要经历两秒读取。卸载旧面板会取消它还未完成的读写。
  onMount(() => {
    const loadTimer = setTimeout(() => setTodos(props.confirmedTodos()), 2000);
    onCleanup(() => {
      clearTimeout(loadTimer);
      clearTimeout(saveTimer);
    });
  });

  return (
    <>
      <div class="ns-card-header">
        <h3 class="ns-card-title">Todo</h3>
        {/* 保存以整份快照为单位，进度只在顶部转圈。 */}
        <Show when={todos()}>
          <span class="ns-badge async-todo-sync" role="status">
            <Show when={pendingCount() > 0}>
              <span class="async-todo-spinner" aria-hidden="true" />
            </Show>
            {pendingCount() > 0 ? `正在同步 ${pendingCount()} 项` : "全部已同步"}
          </span>
        </Show>
      </div>

      <Show
        when={todos()}
        fallback={
          <p class="ns-empty" role="status">
            正在读取任务…
          </p>
        }
      >
        {/* 重新读回列表后，说明有多少项修改随旧面板一起丢弃了。 */}
        <Show when={props.discardedCount > 0}>
          <p class="ns-banner ns-banner-warn" role="status">
            已恢复上次同步的任务。有 {props.discardedCount} 项任务的未确认修改未保留。
          </p>
        </Show>

        {/* 从服务器读到初始列表后，表单和复选框就能立即接受修改。 */}
        <form
          class="ns-todo-composer"
          onSubmit={(event) => {
            event.preventDefault();
            addTodo();
          }}
        >
          <input
            class="ns-input"
            aria-label="新任务"
            placeholder="输入待办事项"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <button class="ns-btn" type="submit" disabled={!draft().trim()}>
            添加
          </button>
        </form>

        {/* 演示只新增和勾选，按位置复用任务行能保留复选框的焦点。 */}
        <ul class="ns-list">
          <Index each={todos()}>
            {(todo) => (
              <li class="ns-list-item">
                <label class="ns-todo-row">
                  <input
                    class="ns-checkbox"
                    type="checkbox"
                    checked={todo().completed}
                    onChange={(event) => toggleTodo(todo().id, event.currentTarget.checked)}
                  />
                  <span
                    class={todo().completed ? "ns-todo-text ns-todo-text-done" : "ns-todo-text"}
                  >
                    {todo().text}
                  </span>
                </label>
                <Show when={isPending(todo())}>
                  <span class="ns-badge ns-badge-muted">待同步</span>
                </Show>
              </li>
            )}
          </Index>
        </ul>
      </Show>

      {/* 保存期间也能重开，让读者观察尚未确认的修改会怎样。 */}
      <button
        class="ns-btn"
        type="button"
        disabled={!todos()}
        onClick={() => props.onReopen(pendingCount())}
      >
        重新打开应用
      </button>
    </>
  );
}

/**
 * 在面板外模拟服务器。换一个打开记录会重建面板，已确认的服务器快照仍在。
 * @returns 能重开并从上次确认的任务恢复的演示。
 */
export default function AsyncTodoDemo() {
  const [confirmedTodos, setConfirmedTodos] = createSignal(INITIAL_TODOS);
  const [opening, setOpening] = createSignal({ discardedCount: 0 });

  // 每次重开都会创建新对象。带 keyed 的 Show 以该对象为键，销毁旧面板并创建新面板。
  return (
    <section class="ns-card dom-demo" aria-label="异步 Todo 演示">
      <Show when={opening()} keyed>
        {(session) => (
          <TodoPanel
            confirmedTodos={confirmedTodos}
            onConfirm={setConfirmedTodos}
            discardedCount={session.discardedCount}
            onReopen={(discardedCount) => setOpening({ discardedCount })}
          />
        )}
      </Show>
    </section>
  );
}
