import { Show, createEffect, createSignal } from "solid-js";

/** 第五章 JSX 与函数组件交互演示的输入属性。 */
export type JsxCounterDemoProps = {
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 演示用 Counter 子组件的输入属性。 */
type CounterViewProps = {
  /** 读取当前计数值的响应式 getter。 */
  count: () => number;
  /** 递增计数的回调。 */
  onIncrement: () => void;
  /** 递减计数的回调。 */
  onDecrement: () => void;
  /** 重置计数的回调。 */
  onReset: () => void;
  /** 组件函数被调用时触发，用于验证更新不会重跑组件。 */
  onComponentRun: () => void;
  /** 响应式文本节点更新时触发，用于对比组件执行次数。 */
  onTextUpdate: () => void;
};

/**
 * 计数器子组件：只在挂载时执行一次，后续靠细粒度表达式更新文本、class 和 disabled。
 *
 * @param props 计数读取器与交互回调。
 * @returns 渲染计数显示与按钮栏的 DOM 片段。
 */
function CounterView(props: CounterViewProps) {
  // 组件函数每次被挂载调用时记录一次，用于直观展示“更新不重跑组件”。
  props.onComponentRun();

  // 真实追踪 count()，每当计数文本重新求值时递增观察计数。
  createEffect(() => {
    props.count();
    props.onTextUpdate();
  });

  return (
    <div>
      {/* 计数数值区：负数时通过动态 class 切换为警示色。 */}
      <div class="ns-counter-display">
        <span class="ns-counter-label">当前计数</span>
        <span
          class={
            props.count() < 0 ? "ns-counter-value ns-counter-value-negative" : "ns-counter-value"
          }
        >
          {props.count()}
        </span>
      </div>
      {/* 操作按钮栏：计数为 0 时通过动态 disabled 自动禁用重置按钮。 */}
      <div class="ns-actions">
        <button type="button" class="ns-btn" onClick={props.onIncrement}>
          +1
        </button>
        <button type="button" class="ns-btn" onClick={props.onDecrement}>
          -1
        </button>
        <button type="button" class="ns-btn" disabled={props.count() === 0} onClick={props.onReset}>
          重置
        </button>
      </div>
    </div>
  );
}

/**
 * 用真正的 SolidJS 驱动第五章预期效果：动态 class、动态 disabled 与单次执行的组件函数。
 *
 * @param props 无障碍说明。
 * @returns 复用共享 .ns-* 样式的交互演示卡片。
 */
export default function JsxCounterDemo(props: JsxCounterDemoProps) {
  // 定义演示卡片的计数值、挂载开关，以及组件执行与文本更新的对比统计。
  const [count, setCount] = createSignal(0);
  const [mounted, setMounted] = createSignal(true);
  const [componentRuns, setComponentRuns] = createSignal(0);
  const [textUpdates, setTextUpdates] = createSignal(0);

  return (
    <section class="ns-card dom-demo" aria-label={props.label ?? "JSX 组件预期效果演示"}>
      {/* 顶部标题与挂载状态徽章。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">nano-solid 计数器</h3>
        <span class={mounted() ? "ns-badge" : "ns-badge ns-badge-muted"}>
          {mounted() ? "已挂载" : "已卸载"}
        </span>
      </div>

      {/* 主体区域：按 mounted 状态切换 CounterView 组件或卸载占位。 */}
      <Show
        when={mounted()}
        fallback={<p class="ns-empty">组件已卸载，对应订阅和事件监听已全部释放。</p>}
      >
        <CounterView
          count={count}
          onIncrement={() => setCount((value) => value + 1)}
          onDecrement={() => setCount((value) => value - 1)}
          onReset={() => setCount(0)}
          onComponentRun={() => setComponentRuns((value) => value + 1)}
          onTextUpdate={() => setTextUpdates((value) => value + 1)}
        />
      </Show>

      {/* 底部栏：控制卸载与重新挂载，并对比“组件函数执行次数”与“文本节点更新次数”。 */}
      <hr class="ns-divider" />
      <div class="ns-actions">
        <button
          type="button"
          class={mounted() ? "ns-btn ns-btn-danger" : "ns-btn"}
          onClick={() => setMounted((value) => !value)}
        >
          {mounted() ? "调用 dispose() 卸载" : "重新挂载"}
        </button>
      </div>
      <p class="ns-meta">
        组件函数执行次数：<code>{componentRuns()}</code>，文本节点更新次数：
        <code>{textUpdates()}</code>
      </p>
    </section>
  );
}
