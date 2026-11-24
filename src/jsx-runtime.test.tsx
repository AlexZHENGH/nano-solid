// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render } from "./dom.ts";
import { jsx } from "./jsx-runtime.ts";
import { createSignal } from "./reactive.ts";

describe("JSX 运行时与子节点归一化", () => {
  it.skip("将原生 JSX 元素与嵌套静态子节点转为真实 DOM", () => {
    const view = (
      <div>
        <p>Hello</p>
        <p>nano-solid</p>
      </div>
    );

    expect(view.node.nodeName).toBe("DIV");
    expect(view.node.childNodes.length).toBe(2);
    expect(view.node.textContent).toBe("Hellonano-solid");
  });

  it.skip("保留数字 0 为文本，同时忽略 boolean、null 与 undefined", () => {
    const view = (
      <p>
        {0}
        {false}
        {true}
        {null}
        {undefined}
        {42}
      </p>
    );

    // 0 不能被误判为假值丢弃，而 boolean 和空值不应渲染出 "false" / "null"。
    expect(view.node.textContent).toBe("042");
  });

  it.skip("递归展平嵌套数组子节点并按原顺序挂载", () => {
    const view = <p>{["A", ["B", [0, "C", false, null]]]}</p>;

    expect(view.node.textContent).toBe("AB0C");
  });

  it.skip("将函数子节点转为响应式文本，并在卸载后停止更新", () => {
    const container = document.createElement("div");
    const [count, setCount] = createSignal(0);
    const readCount = vi.fn(() => count());

    const view = <p>Count: {readCount}</p>;
    const unmount = render(view, container);

    expect(container.textContent).toBe("Count: 0");

    setCount(1);
    expect(container.textContent).toBe("Count: 1");

    unmount();
    setCount(2);

    expect(container.textContent).toBe("");
    expect(readCount).toHaveBeenCalledTimes(2);
  });

  it.skip("传入不支持的子节点类型时显式抛错", () => {
    expect(() => jsx("div", { children: {} as never })).toThrow(/Unsupported JSX child/);
  });
});
