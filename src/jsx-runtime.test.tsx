// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render } from "./dom.ts";
import { jsx } from "./jsx-runtime.ts";
import { createSignal } from "./reactive.ts";

describe("JSX 运行时与子节点归一化", () => {
  it("将原生 JSX 元素与嵌套静态子节点转为真实 DOM", () => {
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

  it("保留数字 0 为文本，同时忽略 boolean、null 与 undefined", () => {
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

  it("递归展平嵌套数组子节点并按原顺序挂载", () => {
    const view = <p>{["A", ["B", [0, "C", false, null]]]}</p>;

    expect(view.node.textContent).toBe("AB0C");
  });

  it("将函数子节点转为响应式文本，并在卸载后停止更新", () => {
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

  it("传入不支持的子节点类型时显式抛错", () => {
    expect(() => jsx("div", { children: {} as never })).toThrow(/Unsupported JSX child/);
  });
});

describe("静态属性与事件绑定", () => {
  it.skip("将静态 id、type 与 class 属性写入真实 DOM 元素", () => {
    const view = (
      <button id="submit-btn" type="button" class="ns-btn">
        提交
      </button>
    );

    const button = view.node as HTMLButtonElement;
    expect(button.id).toBe("submit-btn");
    expect(button.type).toBe("button");
    expect(button.className).toBe("ns-btn");
    expect(button.textContent).toBe("提交");
  });

  it.skip("绑定 onClick 回调并在点击时驱动信号更新视图", () => {
    const container = document.createElement("div");
    const [count, setCount] = createSignal(0);

    const view = (
      <div>
        <span id="value">{() => count()}</span>
        <button id="inc" type="button" onClick={() => setCount(count() + 1)}>
          +1
        </button>
      </div>
    );

    const unmount = render(view, container);
    const value = container.querySelector<HTMLSpanElement>("#value")!;
    const button = container.querySelector<HTMLButtonElement>("#inc")!;

    expect(value.textContent).toBe("0");
    button.click();
    button.click();
    expect(value.textContent).toBe("2");

    unmount();
  });

  it.skip("卸载后成对移除 onClick 监听，不再触发点击回调", () => {
    const container = document.createElement("div");
    const handleClick = vi.fn();

    const view = (
      <button type="button" onClick={handleClick}>
        点我
      </button>
    );
    const button = view.node as HTMLButtonElement;
    const unmount = render(view, container);

    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);

    unmount();
    // 即使保留了按钮引用并在卸载后触发点击，监听也已成对移除。
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
