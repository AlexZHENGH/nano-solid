// 浏览器入口：改用 createReactiveText 挂载响应式计数文本节点。
import { createReactiveText, mount } from "./dom.ts";
import { createSignal } from "./reactive.ts";

const counter = document.querySelector<HTMLElement>("#counter");
const incrementButton = document.querySelector<HTMLButtonElement>("#increment");
const decrementButton = document.querySelector<HTMLButtonElement>("#decrement");
const resetButton = document.querySelector<HTMLButtonElement>("#reset");

if (counter && incrementButton && decrementButton && resetButton) {
  const [count, setCount] = createSignal(0);

  // 清空静态占位文本，挂载由 createReactiveText 驱动的同一个 Text 节点。
  counter.textContent = "";
  const countText = createReactiveText(() => String(count()));
  mount(counter, countText.node);

  incrementButton.addEventListener("click", () => setCount(count() + 1));
  decrementButton.addEventListener("click", () => setCount(count() - 1));
  resetButton.addEventListener("click", () => setCount(0));
}
