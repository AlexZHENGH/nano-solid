import { For, Show, batch, createEffect, createRoot, createSignal, onCleanup } from "solid-js";

/** 控制第三章交互演示展示哪一种响应式边界行为。 */
export type EffectLifecycleDemoProps = {
  /** overview: 整章综合；same-value: 跳过相同值；dynamic-deps: 动态依赖；dispose: 释放句柄。 */
  mode: "overview" | "same-value" | "dynamic-deps" | "dispose";
  /** 演示区域的无障碍名称。 */
  label?: string;
  /** 可选的代码框固定高度，例如 "16rem"，默认沿用样式表中的 11.5rem。 */
  codeHeight?: string;
};

/** 不同模式在初始状态展示的代码骨架。 */
const BASE_LINES: Record<EffectLifecycleDemoProps["mode"], readonly string[]> = {
  overview: [
    "const [isLeft, setIsLeft] = createSignal(true);",
    "const [left, setLeft] = createSignal(0);",
    "const [right, setRight] = createSignal(10);",
    "const dispose = createEffect(() => console.log(isLeft() ? left() : right()));",
  ],
  "same-value": [
    "const [count, setCount] = createSignal(0);",
    "createEffect(() => console.log(count()));",
  ],
  "dynamic-deps": [
    "const [isLeft, setIsLeft] = createSignal(true);",
    "const [left, setLeft] = createSignal(0);",
    "const [right, setRight] = createSignal(10);",
    "createEffect(() => console.log(isLeft() ? left() : right()));",
  ],
  dispose: [
    "const [count, setCount] = createSignal(0);",
    "const dispose = createEffect(() => console.log(count()));",
  ],
};

/**
 * 用真正的 SolidJS 信号、effect 与 createRoot 驱动第三章“代码追加 + Console 输出”演示。
 *
 * @param props 演示模式、高度和无障碍说明。
 * @returns 固定高度、可无限点击的交互演示卡片。
 */
export default function EffectLifecycleDemo(props: EffectLifecycleDemoProps) {
  const [count, setCount] = createSignal(0);
  const [isLeft, setIsLeft] = createSignal(true);
  const [left, setLeft] = createSignal(0);
  const [right, setRight] = createSignal(10);
  const [disposed, setDisposed] = createSignal(false);
  const [appendedLines, setAppendedLines] = createSignal<string[]>([]);
  const [logs, setLogs] = createSignal<number[]>([0]);
  const [highlightLastLog, setHighlightLastLog] = createSignal(false);

  let codeRef: HTMLPreElement | undefined;
  let outputRef: HTMLPreElement | undefined;
  // 保存当前演示 effect 的真实 SolidJS root 释放函数，供 dispose() 和重置使用。
  let disposeActiveRoot: (() => void) | undefined;

  /**
   * 在独立 SolidJS root 中启动被观察的 effect，使 dispose() 真实终止订阅。
   */
  function mountObservedEffect(): void {
    disposeActiveRoot?.();
    let firstRun = true;

    createRoot((dispose) => {
      disposeActiveRoot = dispose;
      createEffect(() => {
        const value =
          props.mode === "overview" || props.mode === "dynamic-deps"
            ? isLeft()
              ? left()
              : right()
            : count();

        if (firstRun) {
          firstRun = false;
          setLogs([value]);
          return;
        }
        setLogs((prev) => [...prev, value]);
        setHighlightLastLog(true);
      });
    });
  }

  mountObservedEffect();
  onCleanup(() => disposeActiveRoot?.());

  // 追加代码行后自动滚到底部，保证最新高亮行始终在视野内。
  createEffect(() => {
    appendedLines();
    if (codeRef) {
      codeRef.scrollTop = codeRef.scrollHeight;
    }
  });

  // 新增日志后自动滚到底部，方便连续点击时直接看到最新输出。
  createEffect(() => {
    logs();
    if (outputRef) {
      outputRef.scrollTop = outputRef.scrollHeight;
    }
  });

  /** 写入当前正在观察的相同值，演示不会触发额外日志。 */
  function handleWriteSame(): void {
    setHighlightLastLog(false);
    if (props.mode === "overview") {
      const targetName = isLeft() ? "setLeft" : "setRight";
      const current = isLeft() ? left() : right();
      batch(() => {
        setAppendedLines((prev) => [...prev, `${targetName}(${current});`]);
        if (isLeft()) {
          setLeft(current);
        } else {
          setRight(current);
        }
      });
      return;
    }

    const current = count();
    batch(() => {
      setAppendedLines((prev) => [...prev, `setCount(${current});`]);
      setCount(current);
    });
  }

  /** 写入一个新值（count + 1）。 */
  function handleWriteNext(): void {
    setHighlightLastLog(false);
    const next = count() + 1;
    batch(() => {
      setAppendedLines((prev) => [...prev, `setCount(${next});`]);
      setCount(next);
    });
  }

  /** 切换 isLeft 布尔值。 */
  function handleToggleBranch(): void {
    const nextIsLeft = !isLeft();
    setHighlightLastLog(false);
    batch(() => {
      setAppendedLines((prev) => [...prev, `setIsLeft(${String(nextIsLeft)});`]);
      setIsLeft(nextIsLeft);
    });
  }

  /** 递增 left。 */
  function handleWriteLeft(): void {
    const next = left() + 1;
    setHighlightLastLog(false);
    batch(() => {
      setAppendedLines((prev) => [...prev, `setLeft(${next});`]);
      setLeft(next);
    });
  }

  /** 递增 right。 */
  function handleWriteRight(): void {
    const next = right() + 1;
    setHighlightLastLog(false);
    batch(() => {
      setAppendedLines((prev) => [...prev, `setRight(${next});`]);
      setRight(next);
    });
  }

  /** 释放当前观察中的 effect（重复调用也安全）。 */
  function handleDispose(): void {
    setHighlightLastLog(false);
    disposeActiveRoot?.();
    disposeActiveRoot = undefined;
    batch(() => {
      setDisposed(true);
      setAppendedLines((prev) => [...prev, "dispose();"]);
    });
  }

  /** 恢复所有状态并重新挂载被观察的 effect。 */
  function handleReset(): void {
    disposeActiveRoot?.();
    disposeActiveRoot = undefined;
    batch(() => {
      setCount(0);
      setIsLeft(true);
      setLeft(0);
      setRight(10);
      setDisposed(false);
      setAppendedLines([]);
      setLogs([0]);
      setHighlightLastLog(false);
    });
    mountObservedEffect();
  }

  const canReset = () => appendedLines().length > 0;

  return (
    <section
      class="console-demo"
      aria-label={props.label ?? "预期效果演示"}
      style={props.codeHeight ? { "--console-demo-code-height": props.codeHeight } : undefined}
    >
      <div class="console-demo-toolbar">
        <Show when={props.mode === "overview"}>
          <button type="button" class="console-demo-btn" onClick={handleWriteSame}>
            {isLeft() ? `同值 setLeft(${left()})` : `同值 setRight(${right()})`}
          </button>
          <button type="button" class="console-demo-btn" onClick={handleToggleBranch}>
            {`setIsLeft(${String(!isLeft())})`}
          </button>
          <button type="button" class="console-demo-btn" onClick={handleWriteLeft}>
            {`setLeft(${left() + 1})`}
          </button>
          <button type="button" class="console-demo-btn" onClick={handleWriteRight}>
            {`setRight(${right() + 1})`}
          </button>
          <button
            type="button"
            class="console-demo-btn console-demo-btn-danger"
            disabled={disposed()}
            onClick={handleDispose}
          >
            {disposed() ? "已 dispose()" : "dispose()"}
          </button>
        </Show>

        <Show when={props.mode === "same-value"}>
          <button type="button" class="console-demo-btn" onClick={handleWriteSame}>
            {`写入相同值 setCount(${count()})`}
          </button>
          <button type="button" class="console-demo-btn" onClick={handleWriteNext}>
            {`写入新值 setCount(${count() + 1})`}
          </button>
        </Show>

        <Show when={props.mode === "dynamic-deps"}>
          <button type="button" class="console-demo-btn" onClick={handleToggleBranch}>
            {`setIsLeft(${String(!isLeft())})`}
          </button>
          <button type="button" class="console-demo-btn" onClick={handleWriteLeft}>
            {`setLeft(${left() + 1})`}
          </button>
          <button type="button" class="console-demo-btn" onClick={handleWriteRight}>
            {`setRight(${right() + 1})`}
          </button>
        </Show>

        <Show when={props.mode === "dispose"}>
          <button type="button" class="console-demo-btn" onClick={handleWriteNext}>
            {`调用 setCount(${count() + 1})`}
          </button>
          <button
            type="button"
            class="console-demo-btn console-demo-btn-danger"
            onClick={handleDispose}
          >
            调用 dispose()
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
