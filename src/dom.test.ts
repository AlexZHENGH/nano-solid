// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createElement, createReactiveText, mount } from "./dom.ts";
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
