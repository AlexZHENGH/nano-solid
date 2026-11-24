// 浏览器入口：使用 JSX 声明静态属性与 onClick 事件，动态 class 暂由外部 createEffect 更新。
import { createElement, render, type Renderable } from "./dom.ts";
import { createEffect, createSignal, type Dispose } from "./reactive.ts";

/**
 * 组装计数器核心视图树，所有响应式文本与按钮事件都随根 Renderable 一起释放。
 *
 * @param count 读取当前计数值的 signal getter。
 * @param setCount 更新计数值的 signal setter。
 * @param onTextUpdate 每次响应式文本重新求值时触发的观察回调，用于统计 DOM 更新次数。
 * @returns 包含计数展示区与加减重置按钮的 Renderable 视图。
 */
function createCounterView(
  count: () => number,
  setCount: (next: number) => void,
  onTextUpdate: () => void,
): Renderable {
  return (
    <div>
      {/* 计数展示区：左侧静态标签，右侧用函数子节点原地刷新同一个 Text 节点。 */}
      <div class="ns-counter-display">
        <span class="ns-counter-label">当前计数</span>
        <span class="ns-counter-value">
          {() => {
            const current = count();
            onTextUpdate();
            return current;
          }}
        </span>
      </div>
      {/* 操作按钮栏：通过 JSX 直接声明 type、class 与 onClick，卸载时自动成对解绑。 */}
      <div class="ns-actions">
        <button type="button" class="ns-btn" onClick={() => setCount(count() + 1)}>
          +1
        </button>
        <button type="button" class="ns-btn" onClick={() => setCount(count() - 1)}>
          -1
        </button>
        <button type="button" class="ns-btn" onClick={() => setCount(0)}>
          重置
        </button>
      </div>
    </div>
  );
}

/**
 * 组装卸载后显示在容器内的虚线占位提示视图。
 *
 * @returns 展示“已卸载”说明的段落 Renderable。
 */
function createEmptyView(): Renderable {
  return <p class="ns-empty">计数器已从容器移除，对应的订阅也已全部释放。</p>;
}

const app = document.querySelector<HTMLElement>("#app");

if (app) {
  // 1. 定义页面级状态：计数值、当前是否已挂载，以及响应式文本累计更新次数。
  const [count, setCount] = createSignal(0);
  const [mounted, setMounted] = createSignal(true);
  const [textUpdates, setTextUpdates] = createSignal(0);
  // 用普通计数累加再写入 signal，避免计数器文本的 effect 反向订阅 textUpdates 形成死循环。
  let updateCount = 0;
  const recordTextUpdate = () => {
    updateCount += 1;
    setTextUpdates(updateCount);
  };

  // 2. 独立挂载宿主：卸载时只操作 host 内部，不影响外层卡片壳。
  const host = createElement("div");

  // 3. 挂载状态徽章与卸载切换按钮：目前动态 class 仍由外部 createEffect 更新。
  const badge = <span>{() => (mounted() ? "已挂载" : "已卸载")}</span>;
  createEffect(() => {
    (badge.node as HTMLSpanElement).className = mounted() ? "ns-badge" : "ns-badge ns-badge-muted";
  });

  let unmountActiveView: Dispose | undefined;
  const toggleButton = (
    <button
      type="button"
      onClick={() => {
        unmountActiveView?.();
        const nextMounted = !mounted();
        setMounted(nextMounted);
        unmountActiveView = render(
          nextMounted ? createCounterView(count, setCount, recordTextUpdate) : createEmptyView(),
          host,
        );
      }}
    >
      {() => (mounted() ? "调用 dispose() 卸载" : "重新挂载")}
    </button>
  );
  createEffect(() => {
    (toggleButton.node as HTMLButtonElement).className = mounted()
      ? "ns-btn ns-btn-danger"
      : "ns-btn";
  });

  // 4. 用 JSX 拼装外层卡片并挂入 #app，再把初始计数器视图挂进独立宿主 host。
  const card = (
    <section class="ns-card">
      <div class="ns-card-header">
        <h1 class="ns-card-title">nano-solid 计数器</h1>
        {badge}
      </div>
      {{ node: host, dispose: () => {} }}
      <hr class="ns-divider" />
      <div class="ns-actions">
        {toggleButton}
        <button type="button" class="ns-btn" onClick={() => setCount(count() + 1)}>
          {() => `外部写入 setCount(${count() + 1})`}
        </button>
      </div>
      <p class="ns-meta">
        信号当前值：<code>{() => count()}</code>，响应式文本更新次数：
        <code>{() => textUpdates()}</code>
      </p>
    </section>
  );

  render(card, app);
  unmountActiveView = render(createCounterView(count, setCount, recordTextUpdate), host);
}
