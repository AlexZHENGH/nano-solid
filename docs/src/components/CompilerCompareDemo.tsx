import { For, createSignal } from "solid-js";

/** 第九章 JSX 编译前后对比演示组件的输入属性。 */
export type CompilerCompareDemoProps = {
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 单个编译对比示例的结构定义。 */
type CompilerSample = {
  id: string;
  title: string;
  source: string;
  runtimeOutput: string;
  compiledOutput: string;
  runtimeNote: string;
  compiledNote: string;
};

/** 三组渐进式 TSX 编译对比样例：静态元素、响应式与事件、以及含 <Show> 的混合树。 */
const SAMPLES: CompilerSample[] = [
  {
    id: "static",
    title: "1. 静态按钮",
    source: `<button id="add-todo" type="button" class="ns-btn">
  添加
</button>`,
    runtimeOutput: `import { jsx } from "#nano-solid/jsx-runtime";

jsx("button", {
  id: "add-todo",
  type: "button",
  class: "ns-btn",
  children: "添加",
});`,
    compiledOutput: `(() => {
  const _el = document.createElement("button");
  _el.id = "add-todo";
  _el.type = "button";
  _el.className = "ns-btn";
  _el.appendChild(document.createTextNode("添加"));
  return _el;
})();`,
    runtimeNote:
      "每次执行都要构造 props 对象，再进 createElement 遍历属性键并调用 normalizeChildren。",
    compiledNote: "零额外 import、零 props 对象分配、零运行时分支判断，直接生成原生 DOM 调用。",
  },
  {
    id: "reactive",
    title: "2. 响应式与事件",
    source: `<button
  class={() => (count() > 0 ? "ns-btn ns-btn-active" : "ns-btn")}
  onClick={inc}
>
  点击了 {() => count()} 次
</button>`,
    runtimeOutput: `import { jsxs } from "#nano-solid/jsx-runtime";

jsxs("button", {
  class: () => (count() > 0 ? "ns-btn ns-btn-active" : "ns-btn"),
  onClick: inc,
  children: ["点击了 ", () => count(), " 次"],
});`,
    compiledOutput: `import {
  bindProperty as _bindProperty,
  createReactiveText as _createReactiveText,
  onCleanup as _onCleanup,
} from "#nano-solid/compiler-runtime";

(() => {
  const _el = document.createElement("button");
  const _p = () => (count() > 0 ? "ns-btn ns-btn-active" : "ns-btn");
  const _h = inc;
  _bindProperty(_el, "class", _p);
  _el.addEventListener("click", _h);
  _onCleanup(() => _el.removeEventListener("click", _h));
  _el.appendChild(document.createTextNode("点击了 "));
  _el.appendChild(_createReactiveText(() => String(count())));
  _el.appendChild(document.createTextNode(" 次"));
  return _el;
})();`,
    runtimeNote: "运行时分配 children 数组并逐项判断类型；事件与属性都在统一大循环里动态分派。",
    compiledNote:
      "静态文本直出 createTextNode，函数子节点直出 createReactiveText，辅助函数按需导入。",
  },
  {
    id: "hybrid",
    title: "3. 混合树（含 Show）",
    source: `<section class="ns-card">
  <Show when={open} fallback={() => <p class="ns-empty">已收起</p>}>
    {() => <p class="ns-meta">{() => details()}</p>}
  </Show>
</section>`,
    runtimeOutput: `import { jsx } from "#nano-solid/jsx-runtime";

jsx("section", {
  class: "ns-card",
  children: jsx(Show, {
    when: open,
    fallback: () => jsx("p", { class: "ns-empty", children: "已收起" }),
    children: () => jsx("p", { class: "ns-meta", children: () => details() }),
  }),
});`,
    compiledOutput: `import {
  appendChildren as _appendChildren,
  createReactiveText as _createReactiveText,
} from "#nano-solid/compiler-runtime";

(() => {
  const _el = document.createElement("section");
  _el.className = "ns-card";
  _appendChildren(
    _el,
    <Show
      when={open}
      fallback={() => (() => {
        const _el2 = document.createElement("p");
        _el2.className = "ns-empty";
        _el2.appendChild(document.createTextNode("已收起"));
        return _el2;
      })()}
    >
      {() => (() => {
        const _el3 = document.createElement("p");
        _el3.className = "ns-meta";
        _el3.appendChild(_createReactiveText(() => String(details())));
        return _el3;
      })()}
    </Show>,
  );
  return _el;
})();`,
    runtimeNote: "从外层容器到每个条件分支里的 <p>，全部走运行时 jsx() 构造与归一化。",
    compiledNote:
      "组件 <Show> 保留 JSX 交给运行时，但它的外层容器和内部懒工厂里的原生标签全部直接编译。",
  },
];

/**
 * 第九章总览交互演示：通过三组可切换的 TSX 样例，并排对比第五章运行时 JSX 输出与第九章编译期直接 DOM 输出。
 *
 * @param props 无障碍说明。
 * @returns 带样例切换栏与左右代码对比的交互卡片。
 */
export default function CompilerCompareDemo(props: CompilerCompareDemoProps) {
  const [activeId, setActiveId] = createSignal(SAMPLES[0]?.id ?? "static");
  const current = () => SAMPLES.find((item) => item.id === activeId()) ?? SAMPLES[0]!;

  return (
    <section
      class="ns-card dom-demo"
      aria-label={props.label ?? "第九章预期效果：JSX 编译前后输出对比"}
    >
      {/* 1. 顶部标题与三组样例切换按钮。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">JSX 编译前后输出对比</h3>
        <div class="ns-actions">
          <For each={SAMPLES}>
            {(sample) => (
              <button
                type="button"
                class={
                  activeId() === sample.id ? "ns-btn ns-btn-sm ns-btn-active" : "ns-btn ns-btn-sm"
                }
                onClick={() => setActiveId(sample.id)}
              >
                {sample.title}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* 2. 上方展示开发者编写的原始 TSX 源码。 */}
      <div class="compiler-demo-panel">
        <div class="compiler-demo-label">
          <span>源码 TSX（两种路径输入完全相同）</span>
        </div>
        <pre class="compiler-demo-pre">
          <code>{current().source}</code>
        </pre>
      </div>

      {/* 3. 下方左右并排对比第五章运行时转换与第九章编译后直接 DOM 调用。 */}
      <div class="compiler-demo-grid">
        <div>
          <div class="compiler-demo-label">
            <span>第 5 章：运行时 JSX 输出</span>
            <span class="ns-badge ns-badge-muted">jsx / jsxs</span>
          </div>
          <pre class="compiler-demo-pre">
            <code>{current().runtimeOutput}</code>
          </pre>
          <p class="compiler-demo-caption">{current().runtimeNote}</p>
        </div>

        <div>
          <div class="compiler-demo-label">
            <span>第 9 章：nano-solid 编译器输出</span>
            <span class="ns-badge">直接 DOM</span>
          </div>
          <pre class="compiler-demo-pre compiler-demo-pre-compiled">
            <code>{current().compiledOutput}</code>
          </pre>
          <p class="compiler-demo-caption">{current().compiledNote}</p>
        </div>
      </div>
    </section>
  );
}
