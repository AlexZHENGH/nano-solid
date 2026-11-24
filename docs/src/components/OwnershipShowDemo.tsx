import { Show, createSignal, onCleanup } from "solid-js";

/** 第六章所有权与条件渲染交互演示的输入属性。 */
export type OwnershipShowDemoProps = {
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 带内部定时器的计数器子组件输入属性。 */
type LiveCounterProps = {
  /** 后台定时器每次触发时递增外层观察计数。 */
  onTick: () => void;
  /** 组件被所有权树清理时递增外层清理计数。 */
  onDispose: () => void;
};

/**
 * 带后台定时器的计数器子组件：挂载时启动定时器，并通过 onCleanup 在隐藏或卸载时自动停止。
 *
 * @param props 用于向外部汇报 tick 与清理次数的回调。
 * @returns 渲染本地计数与加减重置按钮的 DOM 片段。
 */
function LiveCounter(props: LiveCounterProps) {
  // 组件自有的局部状态：每次重新显示都会得到一份全新的初始计数 0。
  const [count, setCount] = createSignal(0);

  // 仅在浏览器环境启动定时器，并把停止逻辑通过 onCleanup 交给当前组件的 Owner 管理。
  if (typeof window !== "undefined") {
    const timer = window.setInterval(() => {
      props.onTick();
    }, 1000);

    onCleanup(() => {
      window.clearInterval(timer);
      props.onDispose();
    });
  }

  return (
    <div>
      {/* 计数展示区：负数切换警示色。 */}
      <div class="ns-counter-display">
        <span class="ns-counter-label">当前计数（组件局部状态）</span>
        <span
          class={count() < 0 ? "ns-counter-value ns-counter-value-negative" : "ns-counter-value"}
        >
          {count()}
        </span>
      </div>
      {/* 操作按钮栏：计数为 0 时自动禁用重置按钮。 */}
      <div class="ns-actions">
        <button type="button" class="ns-btn" onClick={() => setCount((value) => value + 1)}>
          +1
        </button>
        <button type="button" class="ns-btn" onClick={() => setCount((value) => value - 1)}>
          -1
        </button>
        <button type="button" class="ns-btn" disabled={count() === 0} onClick={() => setCount(0)}>
          重置
        </button>
      </div>
    </div>
  );
}

/**
 * 用真正的 SolidJS 驱动第六章预期效果：声明式 Show 分支切换与组件内 onCleanup 自动清理后台定时器。
 *
 * @param props 无障碍说明。
 * @returns 复用共享 .ns-* 样式的交互演示卡片。
 */
export default function OwnershipShowDemo(props: OwnershipShowDemoProps) {
  // 1. 定义显示开关，以及挂在 <Show> 外层的定时器 tick 与清理统计。
  const [visible, setVisible] = createSignal(true);
  const [ticks, setTicks] = createSignal(0);
  const [cleanups, setCleanups] = createSignal(0);

  return (
    <section class="ns-card dom-demo" aria-label={props.label ?? "所有权与条件渲染预期效果演示"}>
      {/* 2. 顶部标题与当前分支状态徽章。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">nano-solid 计数器（自动清理演示）</h3>
        <span class={visible() ? "ns-badge" : "ns-badge ns-badge-muted"}>
          {visible() ? "显示中" : "已隐藏"}
        </span>
      </div>

      {/* 3. 用 <Show> 声明式切换子组件与占位提示，无需手动维护宿主容器和 dispose 句柄。 */}
      <Show
        when={visible()}
        fallback={<p class="ns-empty">计数器已隐藏，组件内定时器也已通过 onCleanup 自动停止。</p>}
      >
        <LiveCounter
          onTick={() => setTicks((value) => value + 1)}
          onDispose={() => setCleanups((value) => value + 1)}
        />
      </Show>

      {/* 4. 底部控制栏与外层观察指标：隐藏后 tick 立刻停住，清理次数递增。 */}
      <hr class="ns-divider" />
      <div class="ns-actions">
        <button
          type="button"
          class={visible() ? "ns-btn ns-btn-danger" : "ns-btn"}
          onClick={() => setVisible((value) => !value)}
        >
          {visible() ? "隐藏计数器（触发 onCleanup）" : "重新显示计数器"}
        </button>
      </div>
      <p class="ns-meta">
        后台定时器 tick：<code>{ticks()}</code>，<code>onCleanup</code> 清理次数：
        <code>{cleanups()}</code>
      </p>
    </section>
  );
}
