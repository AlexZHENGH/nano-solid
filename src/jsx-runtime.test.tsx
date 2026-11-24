// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render } from "./dom.ts";
import { jsx, type JSXChild } from "./jsx-runtime.ts";
import { createEffect, createSignal, onCleanup } from "./reactive.ts";

describe("JSX 运行时与子节点归一化", () => {
  it("将原生 JSX 元素与嵌套静态子节点转为真实 DOM", () => {
    const view = (
      <div>
        <p>Hello</p>
        <p>nano-solid</p>
      </div>
    );

    expect(view.nodeName).toBe("DIV");
    expect(view.childNodes.length).toBe(2);
    expect(view.textContent).toBe("Hellonano-solid");
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
    expect(view.textContent).toBe("042");
  });

  it("递归展平嵌套数组子节点并按原顺序挂载", () => {
    const view = <p>{["A", ["B", [0, "C", false, null]]]}</p>;

    expect(view.textContent).toBe("AB0C");
  });

  it("将函数子节点转为响应式文本，并在卸载后停止更新", () => {
    const container = document.createElement("div");
    const [count, setCount] = createSignal(0);
    const readCount = vi.fn(() => count());

    const unmount = render(() => <p>Count: {readCount}</p>, container);

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
  it("将静态 id、type 与 class 属性写入真实 DOM 元素", () => {
    const button = (
      <button id="submit-btn" type="button" class="ns-btn">
        提交
      </button>
    ) as HTMLButtonElement;

    expect(button.id).toBe("submit-btn");
    expect(button.type).toBe("button");
    expect(button.className).toBe("ns-btn");
    expect(button.textContent).toBe("提交");
  });

  it("绑定 onClick 回调并在点击时驱动信号更新视图", () => {
    const container = document.createElement("div");
    const [count, setCount] = createSignal(0);

    const unmount = render(
      () => (
        <div>
          <span id="value">{() => count()}</span>
          <button id="inc" type="button" onClick={() => setCount(count() + 1)}>
            +1
          </button>
        </div>
      ),
      container,
    );
    const value = container.querySelector<HTMLSpanElement>("#value")!;
    const button = container.querySelector<HTMLButtonElement>("#inc")!;

    expect(value.textContent).toBe("0");
    button.click();
    button.click();
    expect(value.textContent).toBe("2");

    unmount();
  });

  it("卸载后成对移除 onClick 监听，不再触发点击回调", () => {
    const container = document.createElement("div");
    const handleClick = vi.fn();
    let button!: HTMLButtonElement;

    const unmount = render(() => {
      button = (
        <button type="button" onClick={handleClick}>
          点我
        </button>
      ) as HTMLButtonElement;
      return button;
    }, container);

    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);

    unmount();
    // 即使保留了按钮引用并在卸载后触发点击，监听也已通过 onCleanup 成对移除。
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

describe("响应式属性与构造失败回滚", () => {
  it("支持响应式 class，并在卸载后停止追踪更新", () => {
    const container = document.createElement("div");
    const [active, setActive] = createSignal(false);
    const readClass = vi.fn(() => (active() ? "ns-badge" : "ns-badge ns-badge-muted"));
    let span!: HTMLSpanElement;

    const unmount = render(() => {
      span = (<span class={readClass}>状态</span>) as HTMLSpanElement;
      return span;
    }, container);

    expect(span.className).toBe("ns-badge ns-badge-muted");
    expect(readClass).toHaveBeenCalledTimes(1);

    setActive(true);
    expect(span.className).toBe("ns-badge");
    expect(readClass).toHaveBeenCalledTimes(2);

    unmount();
    setActive(false);

    expect(span.className).toBe("ns-badge");
    expect(readClass).toHaveBeenCalledTimes(2);
  });

  it("支持按钮的静态与响应式 disabled，切回 false 后恢复可点击", () => {
    const container = document.createElement("div");
    const [locked, setLocked] = createSignal(true);
    const handleClick = vi.fn();

    const staticBtn = (
      <button type="button" disabled={true}>
        静态禁用
      </button>
    ) as HTMLButtonElement;
    expect(staticBtn.disabled).toBe(true);

    let button!: HTMLButtonElement;
    const unmount = render(() => {
      button = (
        <button type="button" disabled={() => locked()} onClick={handleClick}>
          提交
        </button>
      ) as HTMLButtonElement;
      return button;
    }, container);

    expect(button.disabled).toBe(true);
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(0);

    // 从 true 切回 false 时必须直接更新 button.disabled，按钮才能重新触发点击。
    setLocked(false);
    expect(button.disabled).toBe(false);
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);

    unmount();
    setLocked(true);
    expect(button.disabled).toBe(false);
  });

  it("在非按钮元素上传入 disabled 时显式抛错", () => {
    expect(() => <div disabled={true}>内容</div>).toThrow(/disabled.*div/);
  });

  it("元素构造中途抛错时由 createRoot 回滚已建立的属性订阅与子节点订阅", () => {
    const container = document.createElement("div");
    const [cls, setCls] = createSignal("a");
    const [label, setLabel] = createSignal("init");
    const readClass = vi.fn(() => cls());
    const readLabel = vi.fn(() => label());

    expect(() =>
      render(
        () => (
          <div class={readClass} disabled={true}>
            {readLabel}
          </div>
        ),
        container,
      ),
    ).toThrow(/disabled/);

    expect(readClass).toHaveBeenCalledTimes(1);
    expect(readLabel).toHaveBeenCalledTimes(1);
    expect(container.childNodes.length).toBe(0);

    // 构造失败后必须已经回滚清理，后续改 signal 不应再唤醒任何半截订阅。
    setCls("b");
    setLabel("next");
    expect(readClass).toHaveBeenCalledTimes(1);
    expect(readLabel).toHaveBeenCalledTimes(1);
  });

  it("响应式属性 getter 首次求值抛错时同样回滚并原样重抛", () => {
    const container = document.createElement("div");
    const [cls, setCls] = createSignal("a");
    const readClass = vi.fn(() => cls());

    expect(() =>
      render(
        () => (
          <button
            type="button"
            class={readClass}
            disabled={() => {
              throw new Error("bad disabled");
            }}
          >
            提交
          </button>
        ),
        container,
      ),
    ).toThrow("bad disabled");

    expect(readClass).toHaveBeenCalledTimes(1);
    setCls("b");
    expect(readClass).toHaveBeenCalledTimes(1);
  });

  it("兄弟节点中后一个节点抛错时，render 的根作用域会自动回滚前一个兄弟的订阅与监听", () => {
    const container = document.createElement("div");
    const [label, setLabel] = createSignal("init");
    const readLabel = vi.fn(() => label());
    const handleClick = vi.fn();
    let firstButton!: HTMLButtonElement;

    function FirstSibling(): Node {
      firstButton = (
        <button type="button" onClick={handleClick}>
          {readLabel}
        </button>
      ) as HTMLButtonElement;
      return firstButton;
    }

    function BrokenSibling(): Node {
      throw new Error("second sibling boom");
    }

    // BrokenSibling 抛错时父元素 <div> 尚未进入 createElement，必须靠 render 的 createRoot 清理 FirstSibling。
    expect(() =>
      render(
        () => (
          <div>
            <FirstSibling />
            <BrokenSibling />
          </div>
        ),
        container,
      ),
    ).toThrow("second sibling boom");

    expect(readLabel).toHaveBeenCalledTimes(1);
    expect(container.childNodes.length).toBe(0);

    setLabel("next");
    firstButton.click();
    expect(readLabel).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledTimes(0);
  });
});

describe("函数组件", () => {
  it("支持函数组件渲染，透传 props 与 children 并随卸载释放订阅", () => {
    const container = document.createElement("div");
    const [note, setNote] = createSignal("初始内容");
    const readNote = vi.fn(() => note());

    type CardProps = {
      title: string;
      children?: JSXChild;
    };

    function Card(props: CardProps): Node {
      return (
        <section class="ns-card">
          <h2>{props.title}</h2>
          <div>{props.children}</div>
        </section>
      );
    }

    const unmount = render(
      () => (
        <Card title="提示">
          <p>{readNote}</p>
        </Card>
      ),
      container,
    );

    expect(container.querySelector("h2")?.textContent).toBe("提示");
    expect(container.querySelector("p")?.textContent).toBe("初始内容");
    expect(readNote).toHaveBeenCalledTimes(1);

    setNote("更新内容");
    expect(container.querySelector("p")?.textContent).toBe("更新内容");
    expect(readNote).toHaveBeenCalledTimes(2);

    unmount();
    setNote("卸载后写入");
    expect(container.textContent).toBe("");
    expect(readNote).toHaveBeenCalledTimes(2);
  });

  it("组件函数只在创建时执行一次，点击加减与重置不会重跑组件", () => {
    const container = document.createElement("div");
    const onComponentRun = vi.fn();

    function Counter(): Node {
      onComponentRun();
      const [count, setCount] = createSignal(0);

      return (
        <div>
          <span
            id="counter"
            class={() =>
              count() < 0 ? "ns-counter-value ns-counter-value-negative" : "ns-counter-value"
            }
          >
            {() => count()}
          </span>
          <button id="increment" type="button" onClick={() => setCount(count() + 1)}>
            +1
          </button>
          <button id="decrement" type="button" onClick={() => setCount(count() - 1)}>
            -1
          </button>
          <button
            id="reset"
            type="button"
            disabled={() => count() === 0}
            onClick={() => setCount(0)}
          >
            重置
          </button>
        </div>
      );
    }

    const unmount = render(() => <Counter />, container);
    const counter = container.querySelector<HTMLSpanElement>("#counter")!;
    const increment = container.querySelector<HTMLButtonElement>("#increment")!;
    const decrement = container.querySelector<HTMLButtonElement>("#decrement")!;
    const reset = container.querySelector<HTMLButtonElement>("#reset")!;

    expect(counter.textContent).toBe("0");
    expect(reset.disabled).toBe(true);
    expect(onComponentRun).toHaveBeenCalledTimes(1);

    // 连续点击 +1、-1、重置：文本、class 与 disabled 细粒度更新，组件函数始终只跑过 1 次。
    increment.click();
    increment.click();
    expect(counter.textContent).toBe("2");
    expect(reset.disabled).toBe(false);
    expect(onComponentRun).toHaveBeenCalledTimes(1);

    decrement.click();
    decrement.click();
    decrement.click();
    expect(counter.textContent).toBe("-1");
    expect(counter.className).toBe("ns-counter-value ns-counter-value-negative");
    expect(onComponentRun).toHaveBeenCalledTimes(1);

    reset.click();
    expect(counter.textContent).toBe("0");
    expect(counter.className).toBe("ns-counter-value");
    expect(reset.disabled).toBe(true);
    expect(onComponentRun).toHaveBeenCalledTimes(1);

    // 卸载后再点击保留下来的按钮引用，既不更新 DOM 也不再触发回调。
    unmount();
    increment.click();
    expect(counter.textContent).toBe("0");
    expect(container.textContent).toBe("");
    expect(onComponentRun).toHaveBeenCalledTimes(1);
  });

  it("函数组件卸载时成对清理内部属性订阅、文本订阅与点击监听", () => {
    const container = document.createElement("div");
    const [count, setCount] = createSignal(0);
    const readClass = vi.fn(() => (count() < 0 ? "neg" : "pos"));
    const readDisabled = vi.fn(() => count() === 0);
    const handleClick = vi.fn(() => setCount(count() + 1));

    function ActionBox(): Node {
      return (
        <div class={readClass}>
          <button id="act" type="button" disabled={readDisabled} onClick={handleClick}>
            {() => count()}
          </button>
        </div>
      );
    }

    const unmount = render(() => <ActionBox />, container);
    const button = container.querySelector<HTMLButtonElement>("#act")!;

    setCount(1);
    expect(button.disabled).toBe(false);
    button.click();
    expect(count()).toBe(2);
    expect(handleClick).toHaveBeenCalledTimes(1);

    unmount();
    const classCallsAfterUnmount = readClass.mock.calls.length;
    const disabledCallsAfterUnmount = readDisabled.mock.calls.length;

    // 卸载后外部写入信号与点击按钮均不再触发任何响应式读取或事件回调。
    setCount(-1);
    button.click();
    expect(readClass).toHaveBeenCalledTimes(classCallsAfterUnmount);
    expect(readDisabled).toHaveBeenCalledTimes(disabledCallsAfterUnmount);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("多个同类型函数组件实例各自持有独立状态", () => {
    const container = document.createElement("div");

    type CounterItemProps = {
      id: string;
    };

    function CounterItem(props: CounterItemProps): Node {
      const [count, setCount] = createSignal(0);
      return (
        <div id={props.id}>
          <span class="value">{() => count()}</span>
          <button type="button" onClick={() => setCount(count() + 1)}>
            +1
          </button>
        </div>
      );
    }

    const unmount = render(
      () => (
        <div>
          <CounterItem id="first" />
          <CounterItem id="second" />
        </div>
      ),
      container,
    );

    const first = container.querySelector<HTMLDivElement>("#first")!;
    const second = container.querySelector<HTMLDivElement>("#second")!;

    first.querySelector<HTMLButtonElement>("button")!.click();
    expect(first.querySelector(".value")?.textContent).toBe("1");
    expect(second.querySelector(".value")?.textContent).toBe("0");

    unmount();
  });

  it("函数组件内直接调用 createEffect 与 onCleanup 会随 render 卸载自动释放", () => {
    const container = document.createElement("div");
    const [count, setCount] = createSignal(0);
    const seen: number[] = [];
    const stopped = vi.fn();

    function Watcher(): Node {
      createEffect(() => {
        seen.push(count());
      });
      onCleanup(stopped);
      return <p>{() => count()}</p>;
    }

    const unmount = render(() => <Watcher />, container);
    setCount(1);
    expect(seen).toEqual([0, 1]);
    expect(stopped).toHaveBeenCalledTimes(0);

    unmount();
    setCount(2);
    expect(seen).toEqual([0, 1]);
    expect(stopped).toHaveBeenCalledTimes(1);
  });
});
