// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createElement, createReactiveText, createText, render } from "./dom.ts";
import { createRoot, createSignal, onCleanup } from "./reactive.ts";

describe("响应式文本节点", () => {
  it("创建文本节点并在 signal 变化时原地更新同一个 Text 引用", () => {
    const [count, setCount] = createSignal(0);

    const { node, dispose } = createRoot((disposeRoot) => ({
      node: createReactiveText(() => `Count: ${count()}`),
      dispose: disposeRoot,
    }));
    const originalNode = node;

    expect(node.data).toBe("Count: 0");

    setCount(1);
    expect(node.data).toBe("Count: 1");
    // 细粒度更新只改 node.data，不会新建或替换 Text 节点。
    expect(node).toBe(originalNode);

    dispose();
  });

  it("释放所属作用域后停止响应更新并停留在最后一次的值", () => {
    const [count, setCount] = createSignal(0);
    const getValue = vi.fn(() => `Count: ${count()}`);

    const { node, dispose } = createRoot((disposeRoot) => ({
      node: createReactiveText(getValue),
      dispose: disposeRoot,
    }));
    expect(getValue).toHaveBeenCalledTimes(1);

    setCount(1);
    expect(getValue).toHaveBeenCalledTimes(2);
    expect(node.data).toBe("Count: 1");

    dispose();
    setCount(2);

    expect(getValue).toHaveBeenCalledTimes(2);
    expect(node.data).toBe("Count: 1");
  });

  it("重复释放作用域保持幂等且不抛错", () => {
    const [count, setCount] = createSignal(0);
    const { node, dispose } = createRoot((disposeRoot) => ({
      node: createReactiveText(() => String(count())),
      dispose: disposeRoot,
    }));

    dispose();
    dispose();

    setCount(1);
    expect(node.data).toBe("0");
  });

  it("从 DOM 移除节点并释放作用域后不再更新文本内容", () => {
    const [count, setCount] = createSignal(0);
    const parent = createElement("p");
    const { node, dispose } = createRoot((disposeRoot) => ({
      node: createReactiveText(() => String(count())),
      dispose: disposeRoot,
    }));

    parent.appendChild(node);
    expect(parent.textContent).toBe("0");

    parent.remove();
    dispose();

    setCount(1);
    expect(parent.isConnected).toBe(false);
    expect(node.data).toBe("0");
  });
});

describe("元素树与所有权释放", () => {
  it("按顺序挂载静态和响应式子节点，作用域释放时同步停止子节点更新", () => {
    const [count, setCount] = createSignal(0);
    const getValue = vi.fn(() => String(count()));

    const { parent, dispose } = createRoot((disposeRoot) => ({
      parent: createElement("div", {}, [createText("Count: "), createReactiveText(getValue)]),
      dispose: disposeRoot,
    }));

    expect(parent.textContent).toBe("Count: 0");

    setCount(1);
    expect(parent.textContent).toBe("Count: 1");

    dispose();
    setCount(2);

    expect(parent.textContent).toBe("Count: 1");
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it("释放根作用域时会回收深层元素树里的全部后代订阅", () => {
    const [count, setCount] = createSignal(0);
    const getValue = vi.fn(() => String(count()));

    const { root, dispose } = createRoot((disposeRoot) => ({
      root: createElement("div", {}, [createElement("p", {}, [createReactiveText(getValue)])]),
      dispose: disposeRoot,
    }));

    expect(root.textContent).toBe("0");

    setCount(1);
    expect(root.textContent).toBe("1");

    dispose();
    setCount(2);

    expect(root.textContent).toBe("1");
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it("允许不传属性与子节点，且重复释放作用域保持幂等", () => {
    const { empty, dispose } = createRoot((disposeRoot) => ({
      empty: createElement("div"),
      dispose: disposeRoot,
    }));

    expect(empty.childNodes.length).toBe(0);
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });
});

describe("render 延迟挂载与卸载", () => {
  it("挂载后卸载只移除本次挂载的节点，且重复调用保持安全", () => {
    const container = createElement("div");
    const sibling = createElement("span");
    sibling.textContent = "兄弟节点";
    container.appendChild(sibling);

    const unmount = render(
      () => createElement("p", {}, [createText("Hello nano-solid")]),
      container,
    );

    expect(container.childNodes.length).toBe(2);
    expect(container.textContent).toBe("兄弟节点Hello nano-solid");

    unmount();
    // 卸载只移除本次挂载的节点，不应误删容器里原有的兄弟节点。
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(sibling);

    expect(() => unmount()).not.toThrow();
    expect(container.childNodes.length).toBe(1);
  });

  it("卸载时同步释放子树订阅，已移除的文本节点不再随 signal 更新", () => {
    const container = createElement("div");
    const [count, setCount] = createSignal(0);
    const getValue = vi.fn(() => String(count()));
    let reactiveText!: Text;

    const unmount = render(() => {
      reactiveText = createReactiveText(getValue);
      return createElement("p", {}, [reactiveText]);
    }, container);

    expect(container.textContent).toBe("0");

    setCount(1);
    expect(container.textContent).toBe("1");

    unmount();
    setCount(2);

    // 保留对已移除 Text 节点的引用，验证它没有在后台继续被 effect 更新。
    expect(container.textContent).toBe("");
    expect(reactiveText.data).toBe("1");
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it("重复调用卸载函数时只执行一次底层清理", () => {
    const container = createElement("div");
    const cleanup = vi.fn();

    const unmount = render(() => {
      onCleanup(cleanup);
      return createElement("div");
    }, container);
    unmount();
    unmount();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(container.childNodes.length).toBe(0);
  });

  it("支持挂载 DocumentFragment，卸载时完整移除其全部子节点并保留容器兄弟节点", () => {
    const container = createElement("div");
    const sibling = createElement("span", {}, [createText("原有兄弟")]);
    container.appendChild(sibling);

    const unmount = render(() => {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(createElement("p", {}, [createText("第一段")]));
      fragment.appendChild(createElement("p", {}, [createText("第二段")]));
      return fragment;
    }, container);

    expect(container.childNodes.length).toBe(3);
    expect(container.textContent).toBe("原有兄弟第一段第二段");

    // DocumentFragment 插入后已被清空，卸载必须依赖挂载前快照移除全部两个段落节点。
    unmount();
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(sibling);
  });

  it("卸载期间若有 onCleanup 抛错，仍会在 finally 中移除已挂载的 DOM 节点", () => {
    const container = createElement("div");

    const unmount = render(() => {
      onCleanup(() => {
        throw new Error("cleanup boom");
      });
      return createElement("p", {}, [createText("待卸载节点")]);
    }, container);

    expect(container.childNodes.length).toBe(1);
    expect(() => unmount()).toThrow("cleanup boom");
    // 即使清理回调抛错，已挂载的节点也已在 finally 中从容器移除。
    expect(container.childNodes.length).toBe(0);
  });

  it("节点在卸载前已被外部移到其他容器时，unmount 不会误删它", () => {
    const container = createElement("div");
    const otherContainer = createElement("div");
    let mounted!: HTMLElement;

    const unmount = render(() => {
      mounted = createElement("p", {}, [createText("可移动节点")]);
      return mounted;
    }, container);

    // 外部把节点迁走后，原容器的 unmount 只应清理仍属于原容器的节点。
    otherContainer.appendChild(mounted);
    unmount();

    expect(container.childNodes.length).toBe(0);
    expect(otherContainer.firstChild).toBe(mounted);
  });
});
