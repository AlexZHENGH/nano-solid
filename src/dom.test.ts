// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  createElement,
  createReactiveText,
  createRenderableElement,
  createStaticText,
  mount,
} from "./dom.ts";
import { createSignal } from "./reactive.ts";

describe("响应式文本节点", () => {
  it("创建文本节点并在 signal 变化时原地更新同一个 Text 引用", () => {
    const [count, setCount] = createSignal(0);

    const binding = createReactiveText(() => `Count: ${count()}`);
    const originalNode = binding.node;

    expect(binding.node.data).toBe("Count: 0");

    setCount(1);
    expect(binding.node.data).toBe("Count: 1");
    // 细粒度更新只改 node.data，不会新建或替换 Text 节点。
    expect(binding.node).toBe(originalNode);

    binding.dispose();
  });

  it("调用 dispose 后停止响应更新并停留在最后一次的值", () => {
    const [count, setCount] = createSignal(0);
    const getValue = vi.fn(() => `Count: ${count()}`);

    const binding = createReactiveText(getValue);
    expect(getValue).toHaveBeenCalledTimes(1);

    setCount(1);
    expect(getValue).toHaveBeenCalledTimes(2);
    expect(binding.node.data).toBe("Count: 1");

    binding.dispose();
    setCount(2);

    expect(getValue).toHaveBeenCalledTimes(2);
    expect(binding.node.data).toBe("Count: 1");
  });

  it("重复调用 dispose 保持幂等且不抛错", () => {
    const [count, setCount] = createSignal(0);
    const binding = createReactiveText(() => String(count()));

    binding.dispose();
    binding.dispose();

    setCount(1);
    expect(binding.node.data).toBe("0");
  });

  it("从 DOM 移除节点后调用 dispose 不再更新文本内容", () => {
    const [count, setCount] = createSignal(0);
    const parent = createElement("p");
    const binding = createReactiveText(() => String(count()));

    mount(parent, binding.node);
    expect(parent.textContent).toBe("0");

    // 手动移除 DOM 与释放订阅仍是两步独立操作。
    parent.remove();
    binding.dispose();

    setCount(1);
    expect(parent.isConnected).toBe(false);
    expect(binding.node.data).toBe("0");
  });
});

describe("元素树与递归释放", () => {
  it.skip("按顺序挂载静态和响应式子节点，父节点释放时同步停止子节点更新", () => {
    const [count, setCount] = createSignal(0);
    const getValue = vi.fn(() => String(count()));

    const parent = createRenderableElement("div", [
      createStaticText("Count: "),
      createReactiveText(getValue),
    ]);

    expect(parent.node.textContent).toBe("Count: 0");

    setCount(1);
    expect(parent.node.textContent).toBe("Count: 1");

    parent.dispose();
    setCount(2);

    expect(parent.node.textContent).toBe("Count: 1");
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it.skip("释放根节点时会沿元素树递归释放深层后代订阅", () => {
    const [count, setCount] = createSignal(0);
    const getValue = vi.fn(() => String(count()));

    const root = createRenderableElement("div", [
      createRenderableElement("p", [createReactiveText(getValue)]),
    ]);

    expect(root.node.textContent).toBe("0");

    setCount(1);
    expect(root.node.textContent).toBe("1");

    root.dispose();
    setCount(2);

    expect(root.node.textContent).toBe("1");
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it.skip("允许不传子节点，且重复释放父元素保持幂等", () => {
    const empty = createRenderableElement("div");

    expect(empty.node.childNodes.length).toBe(0);
    expect(() => {
      empty.dispose();
      empty.dispose();
    }).not.toThrow();
  });
});
