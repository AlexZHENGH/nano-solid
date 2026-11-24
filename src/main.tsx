// 浏览器入口：所有动态 class 与 disabled 均由 JSX 响应式属性直接驱动，不再手写外层 createEffect。
import { createElement, render, type Renderable } from "./dom.ts";
import { createSignal, type Dispose } from "./reactive.ts";

/**
 * 组装计数器核心视图树：负数切换警示色、计数为 0 时自动禁用重置按钮。
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
      {/* 计数展示区：负数时通过响应式 class 切换为警示色。 */}
      <div class="ns-counter-display">
        <span class="ns-counter-label">当前计数</span>
        <span
          class={() =>
            count() < 0 ? "ns-counter-value ns-counter-value-negative" : "ns-counter-value"
          }
        >
          {() => {
            const current = count();
            onTextUpdate();
            return current;
          }}
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

  // 2. 独立挂载宿主与当前活跃子视图的卸载句柄。
  const host = createElement("div");
  let unmountActiveView: Dispose | undefined;

  // 3. 用纯 JSX 拼装外层卡片：状态徽章与卸载切换按钮的 class 均由响应式属性驱动。
  const card = (
    <section class="ns-card">
      <div class="ns-card-header">
        <h1 class="ns-card-title">nano-solid 计数器</h1>
        <span class={() => (mounted() ? "ns-badge" : "ns-badge ns-badge-muted")}>
          {() => (mounted() ? "已挂载" : "已卸载")}
        </span>
      </div>
      {{ node: host, dispose: () => {} }}
      <hr class="ns-divider" />
      <div class="ns-actions">
        <button
          type="button"
          class={() => (mounted() ? "ns-btn ns-btn-danger" : "ns-btn")}
          onClick={() => {
            unmountActiveView?.();
            const nextMounted = !mounted();
            setMounted(nextMounted);
            unmountActiveView = render(
              nextMounted
                ? createCounterView(count, setCount, recordTextUpdate)
                : createEmptyView(),
              host,
            );
          }}
        >
          {() => (mounted() ? "调用 dispose() 卸载" : "重新挂载")}
        </button>
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

  // 4. 挂载外层卡片并初始化计数器子视图。
  render(card, app);
  unmountActiveView = render(createCounterView(count, setCount, recordTextUpdate), host);
}
