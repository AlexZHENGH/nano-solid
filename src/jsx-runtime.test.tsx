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

  it("在没有 disabled 的元素上传入该属性时显式抛错", () => {
    // @ts-expect-error: 刻意绕过类型检查，验证运行时也拒绝该属性。
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
          // @ts-expect-error: 故意触发属性校验，以验证抛错前的订阅能回滚。
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

describe("表单输入绑定与 ref", () => {
  it.skip("支持受控输入框的 placeholder、响应式 value、onInput 以及卸载后成对解绑", () => {
    const container = document.createElement("div");
    const [draft, setDraft] = createSignal("初始草稿");
    const onInputSpy = vi.fn((value: string) => setDraft(value));
    let input!: HTMLInputElement;

    const unmount = render(() => {
      input = (
        <input
          type="text"
          placeholder="输入待办事项..."
          value={() => draft()}
          onInput={(event) => onInputSpy(event.currentTarget.value)}
        />
      ) as HTMLInputElement;
      return input;
    }, container);

    expect(input.placeholder).toBe("输入待办事项...");
    expect(input.value).toBe("初始草稿");

    // 模拟用户输入：触发 input 事件把新内容同步回 signal。
    input.value = "买牛奶";
    input.dispatchEvent(new Event("input"));
    expect(draft()).toBe("买牛奶");
    expect(onInputSpy).toHaveBeenCalledTimes(1);

    // 外部写入 signal 应反向同步回 DOM 输入框。
    setDraft("");
    expect(input.value).toBe("");

    // 卸载后监听与响应式订阅都必须已成对移除。
    unmount();
    input.value = "卸载后输入";
    input.dispatchEvent(new Event("input"));
    expect(onInputSpy).toHaveBeenCalledTimes(1);
    setDraft("卸载后写入");
    expect(input.value).toBe("卸载后输入");
  });

  it.skip("响应式 value 与当前 DOM 值相同时跳过重复写入，保留输入光标位置", () => {
    const container = document.createElement("div");
    const [draft, setDraft] = createSignal("hello");
    let input!: HTMLInputElement;

    const unmount = render(() => {
      input = (
        <input
          type="text"
          value={() => draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
      ) as HTMLInputElement;
      return input;
    }, container);

    // 模拟用户在中间插入字符（光标停在第 2 位），随后 input 回调把相同字符串写回 signal。
    input.value = "heXllo";
    input.setSelectionRange(3, 3);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    const valueSetterSpy = vi.spyOn(input, "value", "set").mockImplementation((next) => {
      descriptor.set!.call(input, next);
    });

    input.dispatchEvent(new Event("input"));
    // 因为 element.value 已经是 "heXllo"，effect 应跳过冗余赋值，不触发 setter 也不破坏光标。
    expect(valueSetterSpy).not.toHaveBeenCalled();
    expect(input.selectionStart).toBe(3);

    unmount();
  });

  it.skip("支持复选框的静态与响应式 checked，并在卸载后成对移除 onChange 监听", () => {
    const container = document.createElement("div");
    const [done, setDone] = createSignal(false);
    const onChangeSpy = vi.fn((checked: boolean) => setDone(checked));

    const staticBox = (<input type="checkbox" checked={true} />) as HTMLInputElement;
    expect(staticBox.checked).toBe(true);

    let checkbox!: HTMLInputElement;
    const unmount = render(() => {
      checkbox = (
        <input
          type="checkbox"
          checked={() => done()}
          onChange={(event) => onChangeSpy(event.currentTarget.checked)}
        />
      ) as HTMLInputElement;
      return checkbox;
    }, container);

    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(done()).toBe(true);
    expect(onChangeSpy).toHaveBeenCalledTimes(1);

    setDone(false);
    expect(checkbox.checked).toBe(false);

    unmount();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    setDone(true);
    expect(checkbox.checked).toBe(true);
  });

  it.skip("在不支持的标签上传入表单属性时显式抛错", () => {
    // @ts-expect-error: 刻意传入该标签不支持的属性。
    expect(() => <div value="bad">内容</div>).toThrow(/value.*div/);
    // @ts-expect-error: 刻意传入该标签不支持的属性。
    expect(() => <div checked={true}>内容</div>).toThrow(/checked.*div/);
    // @ts-expect-error: 刻意传入该标签不支持的属性。
    expect(() => <div placeholder="bad">内容</div>).toThrow(/placeholder.*div/);
  });

  it.skip("输入框支持禁用，下拉框挂上选项后才绑定字符串值", () => {
    const container = document.createElement("div");
    const [locked, setLocked] = createSignal(true);
    const [value, setValue] = createSignal("two");

    // 选项文字与 value 不同，避免测试只读到浏览器默认选中的第一项。
    const dispose = render(
      () => (
        <div>
          <input disabled={locked} />
          <select value={value}>
            <option value="one">第一项</option>
            <option value="two">第二项</option>
          </select>
        </div>
      ),
      container,
    );
    const input = container.querySelector("input")!;
    const select = container.querySelector("select")!;
    expect(input.disabled).toBe(true);
    expect(select.value).toBe("two");

    // 同一批节点继续响应 getter，卸载后停止应用变更。
    setLocked(false);
    setValue("one");
    expect(input.disabled).toBe(false);
    expect(select.value).toBe("one");
    dispose();
    setLocked(true);
    setValue("two");
    expect(input.disabled).toBe(false);
    expect(select.value).toBe("one");
  });

  it.skip("ref 回调在属性与子节点完成后收到对应类型的真实 DOM 元素", () => {
    const container = document.createElement("div");
    let capturedInput: HTMLInputElement | undefined;
    let capturedText = "";
    let capturedId = "";

    const unmount = render(
      () => (
        <div
          id="box"
          ref={(el) => {
            capturedId = el.id;
            capturedText = el.textContent ?? "";
          }}
        >
          <span>已有子节点</span>
          <input
            type="text"
            value="初始值"
            ref={(el) => {
              capturedInput = el;
            }}
          />
        </div>
      ),
      container,
    );

    expect(capturedId).toBe("box");
    expect(capturedText).toBe("已有子节点");
    expect(capturedInput).toBeInstanceOf(HTMLInputElement);
    expect(capturedInput?.value).toBe("初始值");

    unmount();
  });

  it.skip("受控表单与 ref 配合：提交后清空草稿并重新聚焦输入框", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const added: string[] = [];

    function Composer(): Node {
      const [draft, setDraft] = createSignal("");
      let inputRef: HTMLInputElement | undefined;

      const submit = () => {
        const text = draft().trim();
        if (!text) return;
        added.push(text);
        setDraft("");
        inputRef?.focus();
      };

      return (
        <div>
          <input
            id="composer-input"
            type="text"
            ref={(el) => {
              inputRef = el;
            }}
            value={() => draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <button
            id="composer-submit"
            type="button"
            disabled={() => draft().trim().length === 0}
            onClick={submit}
          >
            添加
          </button>
        </div>
      );
    }

    const unmount = render(() => <Composer />, container);
    try {
      const input = container.querySelector<HTMLInputElement>("#composer-input")!;
      const submitBtn = container.querySelector<HTMLButtonElement>("#composer-submit")!;

      expect(submitBtn.disabled).toBe(true);

      input.value = "写 Todo 应用";
      input.dispatchEvent(new Event("input"));
      expect(submitBtn.disabled).toBe(false);

      submitBtn.click();
      expect(added).toEqual(["写 Todo 应用"]);
      expect(input.value).toBe("");
      expect(submitBtn.disabled).toBe(true);
      expect(document.activeElement).toBe(input);
    } finally {
      unmount();
      container.remove();
    }
  });
});
