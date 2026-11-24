import { Show, createEffect, createSignal } from "solid-js";

/** 控制第四章 HTML 计数器交互演示的模式。 */
export type DomCounterDemoProps = {
  /** overview: 带挂载、卸载与后台状态写入观察；counter: 仅演示基础计数器交互。 */
  mode: "overview" | "counter";
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 计数器挂载子视图的输入属性。 */
type MountedCounterProps = {
  /** 读取当前计数值的响应式 getter。 */
  count: () => number;
  /** 递增计数的回调。 */
  onIncrement: () => void;
  /** 递减计数的回调。 */
  onDecrement: () => void;
  /** 重置计数的回调。 */
  onReset: () => void;
  /** 每次响应式文本更新时触发的观察回调。 */
  onTextUpdate: () => void;
};

/**
 * 挂载在演示容器中的计数器子视图，卸载时 SolidJS 会自动释放内部 createEffect。
 *
 * @param props 计数状态读取器与按钮事件回调。
 * @returns 包含计数数值区与操作按钮栏的 DOM 片段。
 */
function MountedCounter(props: MountedCounterProps) {
  // 真实追踪 count()，每当文本节点收到一次响应式更新就通知外层累加观察计数。
  createEffect(() => {
    props.count();
    props.onTextUpdate();
  });

  return (
    <div>
      {/* 计数数值展示区：数字由响应式表达式驱动。 */}
      <div class="ns-counter-display">
        <span class="ns-counter-label">当前计数</span>
        <span class="ns-counter-value">{props.count()}</span>
      </div>
      {/* 操作按钮栏：通过回调更新外层信号。 */}
      <div class="ns-actions">
        <button type="button" class="ns-btn" onClick={props.onIncrement}>
          +1
        </button>
        <button type="button" class="ns-btn" onClick={props.onDecrement}>
          -1
        </button>
        <button type="button" class="ns-btn" onClick={props.onReset}>
          重置
        </button>
      </div>
    </div>
  );
}

/**
 * 用真正的 SolidJS 状态与挂载控制驱动第四章预期 HTML 交互效果。
 *
 * @param props 演示模式和无障碍说明。
 * @returns 复用共享 .ns-* 样式的浏览器计数器演示卡片。
 */
export default function DomCounterDemo(props: DomCounterDemoProps) {
  // 定义演示卡片的计数值、挂载状态和文本节点真实更新次数。
  const [count, setCount] = createSignal(0);
  const [mounted, setMounted] = createSignal(true);
  const [textUpdates, setTextUpdates] = createSignal(0);

  return (
    <section class="ns-card dom-demo" aria-label={props.label ?? "计数器预期效果演示"}>
      {/* 顶部标题与挂载状态徽章。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">nano-solid 计数器</h3>
        <Show when={props.mode === "overview"}>
          <span class={mounted() ? "ns-badge" : "ns-badge ns-badge-muted"}>
            {mounted() ? "已挂载" : "已卸载"}
          </span>
        </Show>
      </div>

      {/* 主体区域：按 mounted 状态切换真实计数器或已卸载占位提示。 */}
      <Show
        when={mounted()}
        fallback={<p class="ns-empty">计数器已从容器移除，对应的订阅也已全部释放。</p>}
      >
        <MountedCounter
          count={count}
          onIncrement={() => setCount((value) => value + 1)}
          onDecrement={() => setCount((value) => value - 1)}
          onReset={() => setCount(0)}
          onTextUpdate={() => setTextUpdates((value) => value + 1)}
        />
      </Show>

      {/* 总览模式底部栏：提供卸载/重挂切换、外部写入按钮和更新次数观察行。 */}
      <Show when={props.mode === "overview"}>
        <hr class="ns-divider" />
        <div class="ns-actions">
          <button
            type="button"
            class={mounted() ? "ns-btn ns-btn-danger" : "ns-btn"}
            onClick={() => setMounted((value) => !value)}
          >
            {mounted() ? "调用 dispose() 卸载" : "重新挂载"}
          </button>
          <button type="button" class="ns-btn" onClick={() => setCount((value) => value + 1)}>
            {`外部写入 setCount(${count() + 1})`}
          </button>
        </div>
        <p class="ns-meta">
          信号当前值：<code>{count()}</code>，响应式文本更新次数：<code>{textUpdates()}</code>
        </p>
      </Show>
    </section>
  );
}
