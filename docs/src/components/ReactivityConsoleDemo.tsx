import { For, Show, batch, createEffect, createSignal, on } from "solid-js";

/** 控制交互演示模拟的响应式阶段。 */
export type ReactivityConsoleDemoProps = {
  /** signal: 仅闭包读写；subscribe: 手动订阅通知；effect: 自动依赖追踪。 */
  mode: "signal" | "subscribe" | "effect";
  /** 演示区域的无障碍名称。 */
  label?: string;
  /** 可选的代码框固定高度，例如 "16rem"，默认沿用样式表中的 11.5rem。 */
  codeHeight?: string;
};

/** 不同阶段在页面加载时展示的初始代码。 */
const BASE_LINES: Record<ReactivityConsoleDemoProps["mode"], readonly string[]> = {
  signal: ["const [count, setCount] = createSignal(0);", "console.log(count());"],
  subscribe: [
    "const [count, setCount, subscribe] = createSignal(0);",
    "subscribe(() => console.log(count()));",
  ],
  effect: [
    "const [count, setCount] = createSignal(0);",
    "createEffect(() => console.log(count()));",
  ],
};

/**
 * 用真正的 SolidJS 状态驱动“代码追加调用 + Console 输出”交互演示。
 *
 * @param props 演示模式和无障碍说明。
 * @returns 可点击的演示卡片。
 */
export default function ReactivityConsoleDemo(props: ReactivityConsoleDemoProps) {
  const [count, setCount] = createSignal(0);
  const [nextValue, setNextValue] = createSignal(1);
  const [appendedLines, setAppendedLines] = createSignal<string[]>([]);
  const [logs, setLogs] = createSignal<number[]>(props.mode === "subscribe" ? [] : [0]);
  /** 标记最近一次操作是否新增了日志，用来区分“静默写入”和“产生输出”。 */
  const [highlightLastLog, setHighlightLastLog] = createSignal(false);

  let codeRef: HTMLPreElement | undefined;
  let outputRef: HTMLPreElement | undefined;
  // 重置时跳过响应式副作用的日志追加，避免把复位到 0 误记成一次用户写入。
  let suppressLog = false;

  if (props.mode === "effect") {
    let firstRun = true;
    // 用 SolidJS 的 createEffect 真实追踪 count()，写入后自动追加新值。
    createEffect(() => {
      const value = count();
      if (suppressLog) return;
      if (firstRun) {
        firstRun = false;
        setLogs([value]);
        return;
      }
      setLogs((prev) => [...prev, value]);
      setHighlightLastLog(true);
    });
  } else if (props.mode === "subscribe") {
    // 用 defer: true 模拟手动订阅：登记本身不执行，只在后续写入时触发。
    createEffect(
      on(
        count,
        (value) => {
          if (suppressLog) return;
          setLogs((prev) => [...prev, value]);
          setHighlightLastLog(true);
        },
        { defer: true },
      ),
    );
  }

  // 追加代码行后自动把代码框滚到底部，保证最新高亮的一行始终可见。
  createEffect(() => {
    appendedLines();
    if (codeRef) {
      codeRef.scrollTop = codeRef.scrollHeight;
    }
  });

  // 新增输出后自动把 Console 滚到底部，连续点击时无需手动拖动滚动条。
  createEffect(() => {
    logs();
    if (outputRef) {
      outputRef.scrollTop = outputRef.scrollHeight;
    }
  });

  /** 追加一行 setCount(n) 调用并写入真实 signal。 */
  function handleWrite(): void {
    const value = nextValue();
    batch(() => {
      setAppendedLines((prev) => [...prev, `setCount(${value});`]);
      setNextValue(value + 1);
      if (props.mode === "signal") {
        // signal 模式下写入不会自动打印，清除上一次日志高亮以便观察无输出变化。
        setHighlightLastLog(false);
      }
      setCount(value);
    });
  }

  /** 仅在 signal 模式下手动追加一行 console.log(count()) 并读取当前值。 */
  function handleRead(): void {
    const current = count();
    batch(() => {
      setAppendedLines((prev) => [...prev, "console.log(count());"]);
      setLogs((prev) => [...prev, current]);
      setHighlightLastLog(true);
    });
  }

  /** 把代码框、signal 状态和 Console 恢复到初始状态。 */
  function handleReset(): void {
    suppressLog = true;
    batch(() => {
      setCount(0);
      setNextValue(1);
      setAppendedLines([]);
      setLogs(props.mode === "subscribe" ? [] : [0]);
      setHighlightLastLog(false);
    });
    suppressLog = false;
  }

  const canReset = () => appendedLines().length > 0;

  return (
    <section
      class="console-demo"
      aria-label={props.label ?? "预期效果演示"}
      style={props.codeHeight ? { "--console-demo-code-height": props.codeHeight } : undefined}
    >
      <div class="console-demo-toolbar">
        <button type="button" class="console-demo-btn" onClick={handleWrite}>
          {`调用 setCount(${nextValue()})`}
        </button>
        <Show when={props.mode === "signal"}>
          <button type="button" class="console-demo-btn" onClick={handleRead}>
            调用 console.log(count())
          </button>
        </Show>
      </div>

      <div class="console-demo-panel">
        <div class="console-demo-label">代码</div>
        <pre
          class="console-demo-code"
          ref={(el) => {
            codeRef = el;
          }}
        >
          <code>
            <For each={BASE_LINES[props.mode]}>
              {(line) => <span class="console-demo-line">{line}</span>}
            </For>
            <span class="console-demo-line console-demo-blank" aria-hidden="true">
              {" "}
            </span>
            <span class="console-demo-line console-demo-comment">{"// 演示效果"}</span>
            <For each={appendedLines()}>
              {(line, index) => (
                <span
                  class={
                    index() === appendedLines().length - 1
                      ? "console-demo-line console-demo-line-added"
                      : "console-demo-line"
                  }
                >
                  {line}
                </span>
              )}
            </For>
          </code>
        </pre>
      </div>

      <div class="console-demo-panel">
        <div class="console-demo-label">Console 输出</div>
        <pre
          class="console-demo-output"
          ref={(el) => {
            outputRef = el;
          }}
          aria-live="polite"
        >
          <code>
            <Show
              when={logs().length > 0}
              fallback={<span class="console-demo-empty">还没有输出</span>}
            >
              <For each={logs()}>
                {(entry, index) => (
                  <span
                    class={
                      highlightLastLog() && index() === logs().length - 1
                        ? "console-demo-line console-demo-line-added"
                        : "console-demo-line"
                    }
                  >
                    {entry}
                  </span>
                )}
              </For>
            </Show>
          </code>
        </pre>
      </div>

      <button
        type="button"
        class="console-demo-btn console-demo-reset"
        disabled={!canReset()}
        onClick={handleReset}
      >
        重置
      </button>
    </section>
  );
}
