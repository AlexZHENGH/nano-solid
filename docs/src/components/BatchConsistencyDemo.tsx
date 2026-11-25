import {
  For,
  batch,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js";

/** 第八章批量更新与菱形依赖对比演示组件的输入属性。 */
export type BatchConsistencyDemoProps = {
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 单条待办任务数据结构。 */
type Todo = {
  id: number;
  text: string;
  completed: boolean;
};

/** 观察日志中的单行记录。 */
type TraceEntry = {
  /** 单调递增的记录序号，用于渲染与定位最新一轮变化。 */
  step: number;
  /** 所属操作轮次（0 代表初始挂载）。 */
  round: number;
  /** 观察者读到的状态摘要。 */
  text: string;
  /** 标记是否为中间态或瞬态毛刺。 */
  kind: "normal" | "warn";
  /** 可选行尾状态标签（如“中间态”或“毛刺”）。 */
  tag?: string;
};

/** 与第七章 Todo 应用一致的初始待办任务（1 项已完成，2 项未完成）。 */
const INITIAL_TODOS: Todo[] = [
  { id: 1, text: "实现 createMemo 派生缓存", completed: true },
  { id: 2, text: "实现按 key 复用的 For 列表", completed: false },
  { id: 3, text: "补齐表单输入与行内编辑", completed: false },
];

/** 点击“新增未完成任务”时轮换填充的草稿文案，方便读者反复点击对比。 */
const SAMPLE_DRAFTS = [
  "实现 batch 批量更新",
  "消除菱形依赖毛刺",
  "补齐重入与循环保护",
  "支持按需惰性 memo",
];

/**
 * 第八章总览交互演示：用同一套 Todo“新增未完成任务”操作，直观对比 7.4 旧版内核的逐次同步通知
 * 与真实 SolidJS 驱动的批量合并、三态 Push-Pull 零毛刺行为。
 *
 * @param props 无障碍说明。
 * @returns 带两张实时对比轨迹表的交互演示卡片。
 */
export default function BatchConsistencyDemo(props: BatchConsistencyDemoProps) {
  // 1. 记录当前操作轮次，以及四条可滚底的观察日志列表（旧版与目标各两条）。
  const [round, setRound] = createSignal(0);
  const [todoCount, setTodoCount] = createSignal(INITIAL_TODOS.length);
  const [doneCount, setDoneCount] = createSignal(
    INITIAL_TODOS.filter((todo) => todo.completed).length,
  );
  const [nextDraft, setNextDraft] = createSignal(SAMPLE_DRAFTS[0] ?? "新待办");

  const [legacyBatchTrace, setLegacyBatchTrace] = createSignal<TraceEntry[]>([]);
  const [targetBatchTrace, setTargetBatchTrace] = createSignal<TraceEntry[]>([]);
  const [legacyDiamondTrace, setLegacyDiamondTrace] = createSignal<TraceEntry[]>([]);
  const [targetDiamondTrace, setTargetDiamondTrace] = createSignal<TraceEntry[]>([]);

  let legacyBatchList: HTMLUListElement | undefined;
  let targetBatchList: HTMLUListElement | undefined;
  let legacyDiamondList: HTMLUListElement | undefined;
  let targetDiamondList: HTMLUListElement | undefined;

  let activeRound = 0;
  let nextTodoId = INITIAL_TODOS.length + 1;
  let legacyTodos: Todo[] = INITIAL_TODOS;
  let legacyDraft = SAMPLE_DRAFTS[0] ?? "新待办";

  // 持有真实 SolidJS 演示内核的写入句柄与清理函数，重置时整体重建。
  let disposeTargetKernel: (() => void) | undefined;
  let commitTargetAdd: ((todo: Todo) => void) | undefined;

  /** 把指定日志容器平滑滚到底部，避免追加记录时撑动整页布局。 */
  const scrollToBottom = (element: HTMLUListElement | undefined) => {
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  };

  /** 在微任务中把四张轨迹表一并滚底，确保 DOM 已渲染出本轮新行。 */
  const scrollAllLists = () => {
    queueMicrotask(() => {
      scrollToBottom(legacyBatchList);
      scrollToBottom(targetBatchList);
      scrollToBottom(legacyDiamondList);
      scrollToBottom(targetDiamondList);
    });
  };

  /** 初始化（或重置）真实 SolidJS 目标内核与 7.4 旧版基线记录。 */
  const initKernels = () => {
    disposeTargetKernel?.();
    activeRound = 0;
    nextTodoId = INITIAL_TODOS.length + 1;
    legacyTodos = INITIAL_TODOS;
    legacyDraft = SAMPLE_DRAFTS[0] ?? "新待办";

    setRound(0);
    setTodoCount(INITIAL_TODOS.length);
    setDoneCount(INITIAL_TODOS.filter((todo) => todo.completed).length);
    setNextDraft(legacyDraft);

    // 初始化 7.4 旧版基线首条观察记录。
    setLegacyBatchTrace([
      {
        step: 1,
        round: 0,
        text: `#1 任务 ${legacyTodos.length} 项，草稿 "${legacyDraft}"`,
        kind: "normal",
      },
    ]);
    setLegacyDiamondTrace([
      {
        step: 1,
        round: 0,
        text: "#1 总计 3 - 未完成 2 = 已完成 1",
        kind: "normal",
      },
    ]);

    // 在独立 SolidJS root 中创建真实的目标响应式图（batch + 菱形 createMemo）。
    const nextTargetBatch: TraceEntry[] = [];
    const nextTargetDiamond: TraceEntry[] = [];

    createRoot((dispose) => {
      disposeTargetKernel = dispose;
      const [todos, setTodos] = createSignal<Todo[]>(INITIAL_TODOS);
      const [draft, setDraft] = createSignal(legacyDraft);

      // 构造与 7.4 一致的菱形依赖：todos -> total & remaining -> completed。
      const total = createMemo(() => todos().length);
      const remaining = createMemo(() => todos().filter((todo) => !todo.completed).length);
      const completed = createMemo(() => total() - remaining());

      // 观察者 1：同时读取任务总数与草稿（验证 batch 合并多信号写入）。
      createComputed(() => {
        const count = todos().length;
        const currentDraft = draft();
        const step = nextTargetBatch.length + 1;
        nextTargetBatch.push({
          step,
          round: activeRound,
          text: `#${step} 任务 ${count} 项，草稿 "${currentDraft}"`,
          kind: "normal",
          tag: activeRound > 0 ? "合并为 1 次" : undefined,
        });
        setTargetBatchTrace([...nextTargetBatch]);
      });

      // 观察者 2：只关心已完成数（验证菱形依赖无毛刺且同值截断）。
      createComputed(() => {
        const currentCompleted = completed();
        const step = nextTargetDiamond.length + 1;
        nextTargetDiamond.push({
          step,
          round: activeRound,
          text: `#${step} 已完成 ${currentCompleted} 项`,
          kind: "normal",
        });
        setTargetDiamondTrace([...nextTargetDiamond]);
      });

      commitTargetAdd = (todo: Todo) => {
        batch(() => {
          setTodos((list) => [...list, todo]);
          setDraft("");
        });
      };
    });
  };

  // 组件挂载时立刻初始化演示内核，卸载时释放内部 root。
  initKernels();
  onCleanup(() => {
    disposeTargetKernel?.();
  });

  /** 执行一次“新增未完成任务”：同时驱动 7.4 旧版轨迹与真实 SolidJS 目标内核。 */
  const handleAddActiveTodo = () => {
    const nextRound = activeRound + 1;
    activeRound = nextRound;
    setRound(nextRound);

    const text = nextDraft();
    const newTodo: Todo = { id: nextTodoId, text, completed: false };
    nextTodoId += 1;

    // 1. 复现 7.4 旧版逐次同步写入与朴素菱形 memo 的真实轨迹：
    //    先执行 setTodos([...todos, newTodo])，草稿此时尚未清空（中间态）。
    const prevRemaining = legacyTodos.filter((todo) => !todo.completed).length;
    legacyTodos = [...legacyTodos, newTodo];
    const nextTotal = legacyTodos.length;
    const nextRemaining = prevRemaining + 1;

    setLegacyBatchTrace((list) => [
      ...list,
      {
        step: list.length + 1,
        round: nextRound,
        text: `#${list.length + 1} 任务 ${nextTotal} 项，草稿 "${legacyDraft}"`,
        kind: "warn",
        tag: "中间态",
      },
      {
        step: list.length + 2,
        round: nextRound,
        text: `#${list.length + 2} 任务 ${nextTotal} 项，草稿 ""`,
        kind: "normal",
      },
    ]);
    legacyDraft = "";

    //    朴素 memo 菱形图：total 先推到 completed（此时 remaining 仍是旧值），短暂算出错误的已完成数。
    const glitchCompleted = nextTotal - prevRemaining;
    const settledCompleted = nextTotal - nextRemaining;
    setLegacyDiamondTrace((list) => [
      ...list,
      {
        step: list.length + 1,
        round: nextRound,
        text: `#${list.length + 1} 总计 ${nextTotal} - 未完成 ${prevRemaining} = 已完成 ${glitchCompleted}`,
        kind: "warn",
        tag: "毛刺",
      },
      {
        step: list.length + 2,
        round: nextRound,
        text: `#${list.length + 2} 总计 ${nextTotal} - 未完成 ${nextRemaining} = 已完成 ${settledCompleted}`,
        kind: "normal",
      },
    ]);

    // 2. 用真实 SolidJS 执行同一次 batch 新增：观察者 1 只收到 1 次终态，观察者 2 零毛刺且不被误唤醒。
    commitTargetAdd?.(newTodo);

    // 3. 更新顶部状态与下一条示例草稿，方便读者继续点击。
    setTodoCount(nextTotal);
    setDoneCount(settledCompleted);
    const upcomingDraft =
      SAMPLE_DRAFTS[nextRound % SAMPLE_DRAFTS.length] ?? `新任务 #${nextTodoId}`;
    setNextDraft(upcomingDraft);
    legacyDraft = upcomingDraft;

    scrollAllLists();
  };

  /** 计算单条观察日志的视觉高亮类名。 */
  const rowClass = (entry: TraceEntry) => {
    if (entry.kind === "warn") return "consistency-demo-row consistency-demo-row-warn";
    if (round() > 0 && entry.round === round()) {
      return "consistency-demo-row consistency-demo-row-latest";
    }
    return "consistency-demo-row";
  };

  return (
    <section
      class="ns-card dom-demo"
      aria-label={props.label ?? "第八章预期效果：批量更新与菱形依赖无毛刺对比"}
    >
      {/* 1. 顶部标题与当前 Todo 统计状态。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">Todo 新增操作：观察日志对比</h3>
        <span class="ns-badge">
          共 {todoCount()} 项 · 已完成 {doneCount()} 项
        </span>
      </div>

      {/* 2. 顶部操作区：点击即同时触发一次“新增未完成任务（setTodos + setDraft）”对比。 */}
      <div class="ns-actions">
        <button type="button" class="ns-btn ns-btn-active" onClick={handleAddActiveTodo}>
          新增未完成任务（"{nextDraft()}"）
        </button>
        <button type="button" class="ns-btn" disabled={round() === 0} onClick={initKernels}>
          重置
        </button>
      </div>

      {/* 3. 对比 1：多信号连续写入（setTodos + setDraft("")）是否暴露中间态。 */}
      <div class="consistency-demo-section">
        <p class="consistency-demo-section-title">
          对比 1：观察者同时读 <code>todos().length</code> 与 <code>draft()</code>
        </p>
        <div class="consistency-demo-grid">
          <div class="consistency-demo-col">
            <div class="consistency-demo-col-head">
              <span>7.4 旧版：逐次同步通知</span>
              <span>观察 {legacyBatchTrace().length} 次</span>
            </div>
            <ul
              ref={(element) => {
                legacyBatchList = element;
              }}
              class="consistency-demo-list"
            >
              <For each={legacyBatchTrace()}>
                {(entry) => (
                  <li class={rowClass(entry)}>
                    <span>{entry.text}</span>
                    {entry.tag ? (
                      <span class="consistency-demo-tag consistency-demo-tag-warn">
                        {entry.tag}
                      </span>
                    ) : null}
                  </li>
                )}
              </For>
            </ul>
          </div>

          <div class="consistency-demo-col">
            <div class="consistency-demo-col-head">
              <span>第 8 章目标：batch 合并通知</span>
              <span>观察 {targetBatchTrace().length} 次</span>
            </div>
            <ul
              ref={(element) => {
                targetBatchList = element;
              }}
              class="consistency-demo-list"
            >
              <For each={targetBatchTrace()}>
                {(entry) => (
                  <li class={rowClass(entry)}>
                    <span>{entry.text}</span>
                    {entry.tag ? (
                      <span class="consistency-demo-tag consistency-demo-tag-ok">{entry.tag}</span>
                    ) : null}
                  </li>
                )}
              </For>
            </ul>
          </div>
        </div>
      </div>

      {/* 4. 对比 2：菱形依赖（totalCount - remainingCount）是否短暂算出错误的已完成数。 */}
      <div class="consistency-demo-section">
        <p class="consistency-demo-section-title">
          对比 2：菱形派生 <code>completedCount = totalCount() - remainingCount()</code>
        </p>
        <div class="consistency-demo-grid">
          <div class="consistency-demo-col">
            <div class="consistency-demo-col-head">
              <span>7.4 旧版：朴素 memo 产生毛刺</span>
              <span>观察 {legacyDiamondTrace().length} 次</span>
            </div>
            <ul
              ref={(element) => {
                legacyDiamondList = element;
              }}
              class="consistency-demo-list"
            >
              <For each={legacyDiamondTrace()}>
                {(entry) => (
                  <li class={rowClass(entry)}>
                    <span>{entry.text}</span>
                    {entry.tag ? (
                      <span class="consistency-demo-tag consistency-demo-tag-warn">
                        {entry.tag}
                      </span>
                    ) : null}
                  </li>
                )}
              </For>
            </ul>
          </div>

          <div class="consistency-demo-col">
            <div class="consistency-demo-col-head">
              <span>第 8 章目标：三态 Push-Pull 零毛刺</span>
              <span>观察 {targetDiamondTrace().length} 次</span>
            </div>
            <ul
              ref={(element) => {
                targetDiamondList = element;
              }}
              class="consistency-demo-list"
            >
              <For each={targetDiamondTrace()}>
                {(entry) => (
                  <li class={rowClass(entry)}>
                    <span>{entry.text}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </div>
      </div>

      <p class="ns-meta">
        留意对比 2 右侧：无论连续新增多少条未完成任务，真实 SolidJS 驱动的{" "}
        <code>completedCount</code> 始终只观察 1 次，不会闪现错误数字。
      </p>
    </section>
  );
}
