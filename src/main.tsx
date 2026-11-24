// 浏览器入口：用 <Show> 与组件内 onCleanup 管理条件切换与后台定时器清理。
import { Show } from "./control-flow.ts";
import { render } from "./dom.ts";
import { createSignal, onCleanup } from "./reactive.ts";

/** 带后台定时器的计数器子组件输入属性。 */
type LiveCounterProps = {
  /** 后台定时器每次触发时递增外层观察计数。 */
  onTick: () => void;
  /** 组件被所有权树清理时递增外层清理计数。 */
  onDispose: () => void;
};

/**
 * 带后台定时器的计数器函数组件：挂载时启动定时器，并通过 onCleanup 在隐藏或卸载时自动停止。
 *
 * @param props 向外层汇报 tick 与清理次数的观察回调。
 * @returns 渲染本地计数与加减重置按钮的原生 DOM 节点。
 */
function LiveCounter(props: LiveCounterProps): Node {
  // 组件自有的局部状态：每次被 <Show> 重新显示都会得到全新的初始计数 0。
  const [count, setCount] = createSignal(0);

  // 启动后台定时器，并把停止逻辑通过 onCleanup 交给当前分支的 Owner 管理。
  const timer = window.setInterval(() => {
    props.onTick();
  }, 1000);

  onCleanup(() => {
    window.clearInterval(timer);
    props.onDispose();
  });

  return (
    <div>
      {/* 计数展示区：负数时通过响应式 class 切换为警示色。 */}
      <div class="ns-counter-display">
        <span class="ns-counter-label">当前计数（组件局部状态）</span>
        <span
          class={() =>
            count() < 0 ? "ns-counter-value ns-counter-value-negative" : "ns-counter-value"
          }
        >
          {() => count()}
        </span>
      </div>
      {/* 操作按钮栏：计数为 0 时通过响应式 disabled 自动禁用重置按钮。 */}
      <div class="ns-actions">
        <button type="button" class="ns-btn" onClick={() => setCount(count() + 1)}>
          +1
        </button>
        <button type="button" class="ns-btn" onClick={() => setCount(count() - 1)}>
          -1
        </button>
        <button
          type="button"
          class="ns-btn"
          disabled={() => count() === 0}
          onClick={() => setCount(0)}
        >
          重置
        </button>
      </div>
    </div>
  );
}

/**
 * 计数器隐藏后展示的虚线占位组件。
 *
 * @returns 展示“已隐藏”说明的段落节点。
 */
function EmptyState(): Node {
  return <p class="ns-empty">计数器已隐藏，组件内定时器也已通过 onCleanup 自动停止。</p>;
}

/**
 * 应用根组件：用声明式 <Show> 控制子组件显隐，并在外部实时观察后台定时器 tick 与清理次数。
 *
 * @returns 完整演示卡片的原生 DOM 节点。
 */
function App(): Node {
  // 1. 定义显示开关，以及挂在 <Show> 外层的定时器 tick 与 onCleanup 清理统计。
  const [visible, setVisible] = createSignal(true);
  const [ticks, setTicks] = createSignal(0);
  const [cleanups, setCleanups] = createSignal(0);

  // 用普通计数累加再写入 signal，避免观察回调里的读取反向订阅自身。
  let tickCount = 0;
  const recordTick = () => {
    tickCount += 1;
    setTicks(tickCount);
  };

  let cleanupCount = 0;
  const recordCleanup = () => {
    cleanupCount += 1;
    setCleanups(cleanupCount);
  };

  // 2. 用纯声明式 JSX 拼装整张卡片：彻底告别手写 host 容器与 unmountActiveView。
  return (
    <section class="ns-card">
      <div class="ns-card-header">
        <h1 class="ns-card-title">nano-solid 计数器（自动清理演示）</h1>
        <span class={() => (visible() ? "ns-badge" : "ns-badge ns-badge-muted")}>
          {() => (visible() ? "显示中" : "已隐藏")}
        </span>
      </div>
      <Show when={visible} fallback={() => <EmptyState />}>
        {() => <LiveCounter onTick={recordTick} onDispose={recordCleanup} />}
      </Show>
      <hr class="ns-divider" />
      <div class="ns-actions">
        <button
          type="button"
          class={() => (visible() ? "ns-btn ns-btn-danger" : "ns-btn")}
          onClick={() => setVisible(!visible())}
        >
          {() => (visible() ? "隐藏计数器（触发 onCleanup）" : "重新显示计数器")}
        </button>
      </div>
      <p class="ns-meta">
        后台定时器 tick：<code>{() => ticks()}</code>，<code>onCleanup</code> 清理次数：
        <code>{() => cleanups()}</code>
      </p>
    </section>
  );
}

const app = document.querySelector<HTMLElement>("#app");

if (app) {
  render(() => <App />, app);
}
