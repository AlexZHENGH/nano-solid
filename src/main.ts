// 浏览器入口：演示基于 nano-solid 的计数器、卸载切换与外部状态写入观察。
import {
  createElement,
  createReactiveText,
  createRenderableElement,
  createStaticText,
  render,
  type Renderable,
} from "./dom.ts";
import { createEffect, createSignal, type Dispose } from "./reactive.ts";

/**
 * 创建一个带点击事件和成对清理逻辑的按钮 Renderable。
 *
 * @param label 按钮显示的静态文案。
 * @param onClick 点击按钮时触发的回调。
 * @param className 按钮样式类，默认使用标准 .ns-btn。
 * @returns 包含按钮节点及事件解绑逻辑的 Renderable。
 */
function createButton(
  label: string,
  onClick: () => void,
  className = "ns-btn",
): Renderable<HTMLButtonElement> {
  const button = createRenderableElement("button", [createStaticText(label)]);
  button.node.type = "button";
  button.node.className = className;
  button.node.addEventListener("click", onClick);

  return {
    node: button.node,
    dispose() {
      // 释放按钮时先移除事件监听，再释放按钮内部子节点。
      button.node.removeEventListener("click", onClick);
      button.dispose();
    },
  };
}

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
): Renderable<HTMLDivElement> {
  // 计数展示区：左侧静态标签，右侧用 createReactiveText 原地更新同一个 Text 节点。
  const label = createRenderableElement("span", [createStaticText("当前计数")]);
  label.node.className = "ns-counter-label";

  const value = createRenderableElement("span", [
    createReactiveText(() => {
      const current = count();
      // 记录本轮真实触发的响应式文本更新，供页面底部观察卸载后是否停止更新。
      onTextUpdate();
      return String(current);
    }),
  ]);
  value.node.className = "ns-counter-value";

  const display = createRenderableElement("div", [label, value]);
  display.node.className = "ns-counter-display";

  // 计数器操作按钮：只更新 count 信号，视图刷新交给上面的响应式文本节点。
  const actions = createRenderableElement("div", [
    createButton("+1", () => setCount(count() + 1)),
    createButton("-1", () => setCount(count() - 1)),
    createButton("重置", () => setCount(0)),
  ]);
  actions.node.className = "ns-actions";

  return createRenderableElement("div", [display, actions]);
}

/**
 * 组装卸载后显示在容器内的虚线占位提示视图。
 *
 * @returns 展示“已卸载”说明的段落 Renderable。
 */
function createEmptyView(): Renderable<HTMLParagraphElement> {
  const empty = createRenderableElement("p", [
    createStaticText("计数器已从容器移除，对应的订阅也已全部释放。"),
  ]);
  empty.node.className = "ns-empty";
  return empty;
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

  // 2. 顶部标题栏与挂载状态徽章：徽章文案和配色随 mounted 信号自动切换。
  const title = createRenderableElement("h1", [createStaticText("nano-solid 计数器")]);
  title.node.className = "ns-card-title";

  const badge = createRenderableElement("span", [
    createReactiveText(() => (mounted() ? "已挂载" : "已卸载")),
  ]);
  createEffect(() => {
    badge.node.className = mounted() ? "ns-badge" : "ns-badge ns-badge-muted";
  });

  const header = createRenderableElement("div", [title, badge]);
  header.node.className = "ns-card-header";

  // 3. 计数器独立挂载宿主与分割线：卸载时只操作 host 内部，不影响外层卡片壳。
  const host = createElement("div");

  const divider = createRenderableElement("hr");
  divider.node.className = "ns-divider";

  // 4. 底部控制栏：一个卸载/重新挂载切换按钮，加一个绕过计数器直接改状态的外部写入按钮。
  const toggleButton = createRenderableElement("button", [
    createReactiveText(() => (mounted() ? "调用 dispose() 卸载" : "重新挂载")),
  ]);
  toggleButton.node.type = "button";
  createEffect(() => {
    // 处于已挂载状态时用危险描边提示卸载动作，已卸载状态恢复普通按钮样式。
    toggleButton.node.className = mounted() ? "ns-btn ns-btn-danger" : "ns-btn";
  });

  const externalWriteButton = createRenderableElement("button", [
    createReactiveText(() => `外部写入 setCount(${count() + 1})`),
  ]);
  externalWriteButton.node.type = "button";
  externalWriteButton.node.className = "ns-btn";
  externalWriteButton.node.addEventListener("click", () => setCount(count() + 1));

  const controls = createRenderableElement("div", [toggleButton, externalWriteButton]);
  controls.node.className = "ns-actions";

  // 5. 底部观察行：同时展示外部信号当前值与计数器文本节点的真实更新次数。
  const meta = createRenderableElement("p", [
    createStaticText("信号当前值："),
    createRenderableElement("code", [createReactiveText(() => String(count()))]),
    createStaticText("，响应式文本更新次数："),
    createRenderableElement("code", [createReactiveText(() => String(textUpdates()))]),
  ]);
  meta.node.className = "ns-meta";

  // 6. 组装外层卡片并挂入 #app，再把初始计数器视图挂进独立宿主 host。
  const card = createRenderableElement("section", [
    header,
    { node: host, dispose: () => {} },
    divider,
    controls,
    meta,
  ]);
  card.node.className = "ns-card";
  render(card, app);

  let unmountActiveView: Dispose = render(
    createCounterView(count, setCount, recordTextUpdate),
    host,
  );

  // 7. 点击切换按钮：先调用上一次 render 返回的卸载函数，再按新状态挂载计数器或占位提示。
  toggleButton.node.addEventListener("click", () => {
    unmountActiveView();
    const nextMounted = !mounted();
    setMounted(nextMounted);
    unmountActiveView = render(
      nextMounted ? createCounterView(count, setCount, recordTextUpdate) : createEmptyView(),
      host,
    );
  });
}
