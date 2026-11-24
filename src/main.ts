// 浏览器入口：用 createRenderableElement 组合整棵计数器 DOM 树并挂到 #app。
import {
  createReactiveText,
  createRenderableElement,
  createStaticText,
  mount,
  type Renderable,
} from "./dom.ts";
import { createSignal } from "./reactive.ts";

/**
 * 创建一个带点击事件和成对清理逻辑的按钮 Renderable。
 *
 * @param label 按钮显示的静态文案。
 * @param onClick 点击按钮时触发的回调。
 * @returns 包含按钮节点及事件解绑逻辑的 Renderable。
 */
function createButton(label: string, onClick: () => void): Renderable<HTMLButtonElement> {
  const button = createRenderableElement("button", [createStaticText(label)]);
  button.node.type = "button";
  button.node.className = "ns-btn";
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

const app = document.querySelector<HTMLElement>("#app");

if (app) {
  // 创建计数器的核心响应式状态。
  const [count, setCount] = createSignal(0);

  // 顶部标题栏：由静态标题文本包进卡片头部容器。
  const title = createRenderableElement("h1", [createStaticText("nano-solid 计数器")]);
  title.node.className = "ns-card-title";
  const header = createRenderableElement("div", [title]);
  header.node.className = "ns-card-header";

  // 计数展示区：左侧放静态标签，右侧用 createReactiveText 原地刷新数字。
  const label = createRenderableElement("span", [createStaticText("当前计数")]);
  label.node.className = "ns-counter-label";
  const value = createRenderableElement("span", [createReactiveText(() => String(count()))]);
  value.node.className = "ns-counter-value";
  const display = createRenderableElement("div", [label, value]);
  display.node.className = "ns-counter-display";

  // 操作按钮栏：三个按钮只负责更新 count，DOM 刷新完全交给上面的响应式文本。
  const actions = createRenderableElement("div", [
    createButton("+1", () => setCount(count() + 1)),
    createButton("-1", () => setCount(count() - 1)),
    createButton("重置", () => setCount(0)),
  ]);
  actions.node.className = "ns-actions";

  // 组装顶层卡片并把根节点挂入页面容器 #app。
  const card = createRenderableElement("section", [header, display, actions]);
  card.node.className = "ns-card";
  mount(app, card.node);
}
