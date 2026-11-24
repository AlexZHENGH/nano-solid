// 浏览器入口：所有组件直接返回原生 Node，通过 render(() => <App />, app) 在根作用域内延迟挂载。
import { createElement, render } from "./dom.ts";
import { createSignal, onCleanup, type Dispose } from "./reactive.ts";

/** 计数器子组件的输入属性。 */
type CounterProps = {
  /** 读取当前计数值的 signal getter。 */
  count: () => number;
  /** 递增计数的回调。 */
  onIncrement: () => void;
  /** 递减计数的回调。 */
  onDecrement: () => void;
  /** 重置计数的回调。 */
  onReset: () => void;
  /** 组件函数被创建调用时触发，用于验证更新不会重跑组件函数。 */
  onComponentRun: () => void;
  /** 响应式文本重新求值时触发，用于对比组件函数执行次数。 */
  onTextUpdate: () => void;
};

/**
 * 计数器函数组件：只在挂载时执行一次，后续靠细粒度表达式更新文本、class 和 disabled。
 *
 * @param props 计数值读取器、交互回调与观察钩子。
 * @returns 包含计数展示区与加减重置按钮的原生 DOM 节点。
 */
function Counter(props: CounterProps): Node {
  // 组件函数在每次创建挂载时记录一次；后续点按钮只会更新细粒度表达式，不会再次走到这里。
  props.onComponentRun();

  return (
    <div>
      {/* 计数展示区：负数时通过响应式 class 切换为警示色。 */}
      <div class="ns-counter-display">
        <span class="ns-counter-label">当前计数</span>
        <span
          class={() =>
            props.count() < 0 ? "ns-counter-value ns-counter-value-negative" : "ns-counter-value"
          }
        >
          {() => {
            const current = props.count();
            props.onTextUpdate();
            return current;
          }}
        </span>
      </div>
      {/* 操作按钮栏：计数为 0 时通过响应式 disabled 自动禁用重置按钮。 */}
      <div class="ns-actions">
        <button type="button" class="ns-btn" onClick={props.onIncrement}>
          +1
        </button>
        <button type="button" class="ns-btn" onClick={props.onDecrement}>
          -1
        </button>
        <button
          type="button"
          class="ns-btn"
          disabled={() => props.count() === 0}
          onClick={props.onReset}
        >
          重置
        </button>
      </div>
    </div>
  );
}

/**
 * 卸载后展示在宿主容器内的虚线占位组件。
 *
 * @returns 展示“已卸载”说明的段落节点。
 */
function EmptyState(): Node {
  return <p class="ns-empty">组件已卸载，对应订阅和事件监听已全部释放。</p>;
}

/**
 * 应用根组件：管理计数状态、挂载切换以及“组件执行次数 / 文本更新次数”对比观察。
 *
 * @returns 完整计数器演示卡片的原生 DOM 节点。
 */
function App(): Node {
  // 1. 定义页面级状态：计数值、挂载开关，以及组件执行与文本更新的对比统计。
  const [count, setCount] = createSignal(0);
  const [mounted, setMounted] = createSignal(true);
  const [componentRuns, setComponentRuns] = createSignal(0);
  const [textUpdates, setTextUpdates] = createSignal(0);

  // 用普通计数累加再写入 signal，避免观察回调里的读取反向订阅自身形成循环。
  let runCount = 0;
  const recordComponentRun = () => {
    runCount += 1;
    setComponentRuns(runCount);
  };

  let updateCount = 0;
  const recordTextUpdate = () => {
    updateCount += 1;
    setTextUpdates(updateCount);
  };

  // 2. 独立挂载宿主与当前活跃子组件的卸载句柄。
  const host = createElement("div");
  let unmountActiveView: Dispose | undefined;

  /** 按指定状态在宿主容器内挂载 <Counter /> 或 <EmptyState />。 */
  const mountActiveView = (shouldMount: boolean) => {
    unmountActiveView?.();
    unmountActiveView = render(
      () =>
        shouldMount ? (
          <Counter
            count={count}
            onIncrement={() => setCount(count() + 1)}
            onDecrement={() => setCount(count() - 1)}
            onReset={() => setCount(0)}
            onComponentRun={recordComponentRun}
            onTextUpdate={recordTextUpdate}
          />
        ) : (
          <EmptyState />
        ),
      host,
    );
  };

  // 3. 首次创建即挂载 <Counter />，并直接用 onCleanup 把子视图清理挂到 App 所属的根作用域。
  mountActiveView(true);
  onCleanup(() => {
    unmountActiveView?.();
    unmountActiveView = undefined;
  });

  // 4. 用纯 JSX 拼装外层卡片：直接嵌入原生 host 节点，无需再包一层 Renderable。
  return (
    <section class="ns-card">
      <div class="ns-card-header">
        <h1 class="ns-card-title">nano-solid 计数器</h1>
        <span class={() => (mounted() ? "ns-badge" : "ns-badge ns-badge-muted")}>
          {() => (mounted() ? "已挂载" : "已卸载")}
        </span>
      </div>
      {host}
      <hr class="ns-divider" />
      <div class="ns-actions">
        <button
          type="button"
          class={() => (mounted() ? "ns-btn ns-btn-danger" : "ns-btn")}
          onClick={() => {
            const nextMounted = !mounted();
            setMounted(nextMounted);
            mountActiveView(nextMounted);
          }}
        >
          {() => (mounted() ? "调用 dispose() 卸载" : "重新挂载")}
        </button>
        <button type="button" class="ns-btn" onClick={() => setCount(count() + 1)}>
          {() => `外部写入 setCount(${count() + 1})`}
        </button>
      </div>
      <p class="ns-meta">
        组件函数执行次数：<code>{() => componentRuns()}</code>，文本节点更新次数：
        <code>{() => textUpdates()}</code>
      </p>
    </section>
  );
}

const app = document.querySelector<HTMLElement>("#app");

if (app) {
  render(() => <App />, app);
}
