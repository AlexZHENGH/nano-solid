// @vitest-environment jsdom

import { expect, it } from "vitest";
import { mountCounter } from "./counter.ts";

/** 构造与 index.html 一致的最小计数器 DOM，供 jsdom 测试复用。 */
function createCounterFixture(): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <span id="counter"></span>
    <button id="increment" type="button">+1</button>
    <button id="decrement" type="button">-1</button>
    <button id="reset" type="button">重置</button>
  `;
  return root;
}

it.skip("点击加减与重置按钮会通过 signal 和 effect 更新显示", () => {
  const root = createCounterFixture();
  const dispose = mountCounter(root);

  const counter = root.querySelector<HTMLElement>("#counter")!;
  const increment = root.querySelector<HTMLButtonElement>("#increment")!;
  const decrement = root.querySelector<HTMLButtonElement>("#decrement")!;
  const reset = root.querySelector<HTMLButtonElement>("#reset")!;

  expect(counter.textContent).toBe("0");

  increment.click();
  increment.click();
  expect(counter.textContent).toBe("2");

  decrement.click();
  expect(counter.textContent).toBe("1");

  reset.click();
  expect(counter.textContent).toBe("0");

  dispose();
});

it.skip("调用返回的清理函数后，再点击按钮不再更新页面", () => {
  const root = createCounterFixture();
  const dispose = mountCounter(root);

  const counter = root.querySelector<HTMLElement>("#counter")!;
  const increment = root.querySelector<HTMLButtonElement>("#increment")!;

  increment.click();
  expect(counter.textContent).toBe("1");

  dispose();
  increment.click();
  expect(counter.textContent).toBe("1");
});
