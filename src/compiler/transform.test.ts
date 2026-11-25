// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { describe, expect, it, vi } from "vitest";
import * as compilerRuntime from "../compiler-runtime.ts";
import { render } from "../dom.ts";
import { createSignal } from "../reactive.ts";
import { normalizeJSXText, transformJSX, type TransformOptions } from "./transform.ts";

/** 执行编译后的纯表达式代码并返回生成的 DOM 节点（用于验证静态编译结果）。 */
function evaluateCompiledExpression(source: string): Node {
  const result = transformJSX(`const view = ${source};`, { filename: "test.tsx" });
  expect(result).not.toBeNull();
  const factory = new Function(`${result!.code}\nreturn view;`) as () => Node;
  return factory();
}

/**
 * 将编译产物中的 compiler-runtime 导入改写为运行时对象解构并在注入的上下文中求值，
 * 用于直接验证编译后代码与真实 compiler-runtime、render、createSignal 的端到端行为。
 */
function evaluateCompiledModule<T>(
  source: string,
  bindings: Record<string, unknown> = {},
  options?: TransformOptions,
): { code: string; value: T } {
  const result = transformJSX(source, { filename: "module.tsx", ...options });
  expect(result).not.toBeNull();

  // 把编译生成的 import { a as _a, ... } from "..." 绑定到真实的 compilerRuntime 导出，保留编译期生成的局部别名以检验命名冲突。
  const executable = result!.code.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["'];?/gm,
    (_match, specifiers: string) => {
      const destructured = specifiers
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.replace(/\s+as\s+/, ": "))
        .join(", ");
      return `const { ${destructured} } = __compilerRuntime;`;
    },
  );

  const argNames = ["__compilerRuntime", ...Object.keys(bindings)];
  const argValues = [compilerRuntime, ...Object.values(bindings)];
  const runner = new Function(...argNames, `${executable}\nreturn __result;`) as (
    ...args: unknown[]
  ) => T;

  return {
    code: result!.code,
    value: runner(...argValues),
  };
}

describe("静态原生 JSX 编译器", () => {
  it("把静态原生标签与纯文本编译为直接 DOM 创建与插入调用，不依赖 jsx 运行时", () => {
    const result = transformJSX("const el = <button>添加</button>;");
    expect(result).not.toBeNull();
    expect(result!.code).toContain('document.createElement("button")');
    expect(result!.code).toContain('document.createTextNode("添加")');
    expect(result!.code).not.toContain("jsx(");

    const node = evaluateCompiledExpression("<button>添加</button>");
    expect(node).toBeInstanceOf(HTMLButtonElement);
    expect(node.textContent).toBe("添加");
    expect(node.childNodes.length).toBe(1);
    expect(node.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("把多层嵌套的静态原生标签展平编译进同一个 IIFE，执行后生成等价 DOM 树", () => {
    const source = `
      <section>
        <h1>nano-solid</h1>
        <div>
          <span>编译期</span>
          <strong>直接 DOM</strong>
        </div>
      </section>
    `;
    const result = transformJSX(`const view = ${source};`);
    expect(result).not.toBeNull();
    // 整棵静态子树只包一层 IIFE，不给每个子元素重复造闭包。
    const iifeMatches = result!.code.match(/\(\(\)\s*=>\s*\{/g) ?? [];
    expect(iifeMatches.length).toBe(1);

    const node = evaluateCompiledExpression(source) as HTMLElement;
    expect(node.tagName).toBe("SECTION");
    expect(node.children.length).toBe(2);
    expect(node.querySelector("h1")?.textContent).toBe("nano-solid");
    expect(node.querySelector("span")?.textContent).toBe("编译期");
    expect(node.querySelector("strong")?.textContent).toBe("直接 DOM");
  });

  it('遵循标准 JSX 空白规则：保留同行空格与显式 {" "}，裁掉跨行缩进并忽略 JSX 注释', () => {
    // 1. 直接验证空白清洗函数。
    expect(normalizeJSXText("   ")).toBe("   ");
    expect(normalizeJSXText("\n    \n")).toBe("");
    expect(normalizeJSXText("\n  Hello\n  World\n")).toBe("Hello World");
    expect(normalizeJSXText("Count: ")).toBe("Count: ");

    // 2. 验证同行多空格、跨行缩进、JSX 注释与显式 {" "} 表达式。
    const inline = evaluateCompiledExpression("<p>A    B</p>");
    expect(inline.textContent).toBe("A    B");

    const withCommentAndExplicitSpace = evaluateCompiledExpression(`
      <p>
        {/* 这条注释不应生成任何节点 */}
        <span>左</span>
        {" "}
        <span>右</span>
      </p>
    `);
    expect(withCommentAndExplicitSpace.textContent).toBe("左 右");
    expect(withCommentAndExplicitSpace.childNodes.length).toBe(3);
  });

  it("保留函数组件与带展开属性的原生标签，但继续编译组件内部支持的静态子树", () => {
    const source = `
      function App() {
        return (
          <Card>
            <div>静态内容</div>
            <button {...extraProps}>展开属性交运行时</button>
          </Card>
        );
      }
    `;
    const result = transformJSX(source);
    expect(result).not.toBeNull();
    // 外层 <Card> 与带 spread 属性的 <button> 保留 JSX 交给运行时。
    expect(result!.code).toContain("<Card>");
    expect(result!.code).toContain("<button {...extraProps}>");
    // 内部的无属性静态 <div> 已被直接编译，且作为 <Card> 子节点包在 JSX 表达式容器 {} 中。
    expect(result!.code).toContain('document.createElement("div")');
    expect(result!.code).toContain('document.createTextNode("静态内容")');
  });

  it("当源码中没有任何可编译的原生 JSX 时返回 null，避免无谓改写", () => {
    expect(transformJSX("export const x = 1 + 2;")).toBeNull();
    expect(transformJSX("const el = <Counter />;")).toBeNull();
    expect(transformJSX("const el = <div {...extraProps} />;")).toBeNull();
  });

  it("编译后的输出附带有效 source map", () => {
    const result = transformJSX("const el = <span>hi</span>;", { filename: "sample.tsx" });
    expect(result).not.toBeNull();
    expect(result!.map).not.toBeNull();
    expect(result!.map?.sources).toContain("sample.tsx");
    expect(result!.map?.mappings.length).toBeGreaterThan(0);
  });
});

describe("动态子节点编译与按需注入 compiler-runtime", () => {
  it("把函数字面量子节点编译为 createReactiveText，并保持普通表达式 {count()} 只求值一次的静态快照语义", () => {
    const [count, setCount] = createSignal(1);
    const { code, value: view } = evaluateCompiledModule<() => Node>(
      `
        const __result = () => (
          <p>
            动态：{() => count()} / 块体：{() => {
              return count() * 10;
            }} / 快照：{count()}
          </p>
        );
      `,
      { count },
    );

    // 函数字面量直出 createReactiveText，普通调用表达式交给 appendChildren。
    expect(code).toContain("createReactiveText as _createReactiveText");
    expect(code).toContain("appendChildren as _appendChildren");

    const container = document.createElement("div");
    const unmount = render(view, container);

    expect(container.textContent).toBe("动态：1 / 块体：10 / 快照：1");
    const reactiveTextNode = container.firstChild?.childNodes[1];

    // 状态变化后，两个函数子节点原地更新同一个 Text 节点，快照保持首次求值的 1。
    setCount(2);
    expect(container.textContent).toBe("动态：2 / 块体：20 / 快照：1");
    expect(container.firstChild?.childNodes[1]).toBe(reactiveTextNode);

    // 卸载后所有权树释放，后续写入不再更新旧节点。
    unmount();
    setCount(3);
    expect(reactiveTextNode?.textContent).toBe("2");
  });

  it("通过 appendChildren 保持数字 0、布尔/空值、嵌套数组、原生 Node、DocumentFragment 与函数变量的运行时等价性", () => {
    const [label, setLabel] = createSignal("初始");
    const badge = document.createElement("em");
    badge.textContent = "节点";
    const fragment = document.createDocumentFragment();
    const fragSpan = document.createElement("i");
    fragSpan.textContent = "片段";
    fragment.appendChild(fragSpan);

    const { value: view } = evaluateCompiledModule<() => Node>(
      `
        const __result = () => (
          <div>
            {0}
            {false}
            {true}
            {null}
            {undefined}
            {["-", [1, 2], "-"]}
            {badge}
            {fragment}
            {getLabel}
          </div>
        );
      `,
      { badge, fragment, getLabel: label },
    );

    const container = document.createElement("div");
    const unmount = render(view, container);
    expect(container.textContent).toBe("0-12-节点片段初始");

    // 作为变量传入的函数子节点经过 appendChildren -> normalizeChildren 后同样具备响应式更新。
    setLabel("已更新");
    expect(container.textContent).toBe("0-12-节点片段已更新");
    unmount();
  });

  it("纯静态 JSX 不注入任何 import；多处动态表达式只合并注入一条 import 并支持自定义 runtimeModule", () => {
    const staticResult = transformJSX("const el = <div><span>纯静态</span></div>;");
    expect(staticResult).not.toBeNull();
    expect(staticResult!.code).not.toContain("import ");

    const dynamicResult = transformJSX(
      `
        const a = <p>{() => count()}</p>;
        const b = <p>{() => count() + 1}</p>;
        const c = <p>{label}{other}</p>;
      `,
      { runtimeModule: "nano-solid/compiler-runtime" },
    );
    expect(dynamicResult).not.toBeNull();

    const importLines = dynamicResult!.code.match(/^import\s/gm) ?? [];
    expect(importLines.length).toBe(1);
    expect(dynamicResult!.code).toContain('from "nano-solid/compiler-runtime"');
    expect(dynamicResult!.code).toContain("appendChildren as ");
    expect(dynamicResult!.code).toContain("createReactiveText as ");
  });

  it("当用户代码在模块顶层或嵌套函数内声明了同名标识符时，生成的辅助导入别名与局部变量均不发生冲突", () => {
    const [count, setCount] = createSignal(5);
    const { value: view } = evaluateCompiledModule<() => Node>(
      `
        const createReactiveText = "outer-fn";
        const appendChildren = "outer-append";
        const _createReactiveText = "outer-prefixed";
        const _el = "outer-el";

        function makeView() {
          const _appendChildren = "inner-shadowed";
          const _el2 = "inner-el";
          return (
            <section>
              <span>{() => count()}</span>
              <span>{suffix}</span>
              <span>{createReactiveText.length + appendChildren.length + _createReactiveText.length + _appendChildren.length + _el.length + _el2.length}</span>
            </section>
          );
        }

        const __result = makeView;
      `,
      { count, suffix: "!" },
    );

    const container = document.createElement("div");
    const unmount = render(view, container);
    expect(container.querySelectorAll("span")[0]?.textContent).toBe("5");
    expect(container.querySelectorAll("span")[1]?.textContent).toBe("!");

    setCount(6);
    expect(container.querySelectorAll("span")[0]?.textContent).toBe("6");
    unmount();
  });

  it("已编译的原生容器内嵌组件或未支持子元素时，通过 appendChildren 委托外层同时继续编译其内部受支持的原生子树", () => {
    const source = `
      const view = (
        <section>
          <Card>
            <span>组件内部文本</span>
          </Card>
          <button {...extraProps}>
            <strong>展开属性内部仍编译</strong>
          </button>
        </section>
      );
    `;
    const result = transformJSX(source);
    expect(result).not.toBeNull();

    // 外层 <section> 已编译并通过 _appendChildren 挂载 <Card> 和带 spread 的 <button>。
    expect(result!.code).toContain('document.createElement("section")');
    expect(result!.code).toContain("appendChildren as _appendChildren");
    expect(result!.code).toContain("<Card>");
    expect(result!.code).toContain("<button {...extraProps}>");

    // 更深层位于 <Card> 和 <button {...extraProps}> 内部的 <span> 与 <strong> 也都被继续编译为直接 DOM 调用。
    expect(result!.code).toContain('document.createElement("span")');
    expect(result!.code).toContain('document.createTextNode("组件内部文本")');
    expect(result!.code).toContain('document.createElement("strong")');
    expect(result!.code).toContain('document.createTextNode("展开属性内部仍编译")');
  });

  it("动态子节点在构造中途抛错时，沿当前 Owner 回滚已建立的响应式文本订阅", () => {
    const [count, setCount] = createSignal(0);
    let runs = 0;

    const { value: view } = evaluateCompiledModule<() => Node>(
      `
        const __result = () => (
          <div>
            <span>{() => {
              runs();
              return count();
            }}</span>
            <span>{fail()}</span>
          </div>
        );
      `,
      {
        count,
        runs: () => {
          runs += 1;
        },
        fail: () => {
          throw new Error("boom in second child");
        },
      },
    );

    const container = document.createElement("div");
    expect(() => render(view, container)).toThrow("boom in second child");
    expect(runs).toBe(1);

    // 构造失败后，第一个子节点登记的 reactive text effect 已被 Owner 回滚清理。
    setCount(1);
    expect(runs).toBe(1);
  });
});

describe("属性、事件、ref 与混合树编译", () => {
  it.skip("把编译期确定的静态属性直出为原生 DOM 赋值与 setAttribute，零额外运行时导入", () => {
    const source = `
      <section id="panel" class="ns-card">
        <input type="text" class="ns-input" placeholder="输入内容" aria-label="任务名" value="初值" />
        <input type="checkbox" checked />
        <button id="submit" type="button" class="ns-btn" disabled>提交</button>
      </section>
    `;
    const result = transformJSX(`const view = ${source};`);
    expect(result).not.toBeNull();
    // 纯静态属性与文本不需要注入任何 compiler-runtime 导入。
    expect(result!.code).not.toContain("import ");
    expect(result!.code).toContain('.id = "panel"');
    expect(result!.code).toContain('.className = "ns-card"');
    expect(result!.code).toContain('.setAttribute("type", "text")');
    expect(result!.code).toContain('.placeholder = "输入内容"');
    expect(result!.code).toContain('.setAttribute("aria-label", "任务名")');
    expect(result!.code).toContain(".checked = true");
    expect(result!.code).toContain(".disabled = true");

    const section = evaluateCompiledExpression(source) as HTMLElement;
    const [textInput, checkbox] = Array.from(section.querySelectorAll("input"));
    const button = section.querySelector("button")!;

    expect(section.id).toBe("panel");
    expect(section.className).toBe("ns-card");
    expect(textInput?.placeholder).toBe("输入内容");
    expect(textInput?.getAttribute("aria-label")).toBe("任务名");
    expect(textInput?.value).toBe("初值");
    expect(checkbox?.checked).toBe(true);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("提交");
  });

  it.skip("编译后先挂载下拉选项再绑定 value，且保持属性表达式的求值顺序", () => {
    const [value, setValue] = createSignal("two");
    const [disabled, setDisabled] = createSignal(true);
    const calls: string[] = [];
    const container = document.createElement("div");

    // 让选项的文本表达式记录求值时机，检查 value 表达式仍按源码顺序求值。
    const { value: view } = evaluateCompiledModule<() => Node>(
      `const __result = () => (
        <div>
          <input disabled={disabled} />
          <select value={(calls.push("属性"), value)}>
            <option value="one">一</option>
            <option value="two">{(calls.push("子节点"), "二")}</option>
          </select>
        </div>
      );`,
      { value, disabled, calls },
    );
    const dispose = render(view, container);
    const input = container.querySelector("input")!;
    const select = container.querySelector("select")!;
    expect(calls).toEqual(["属性", "子节点"]);
    expect(input.disabled).toBe(true);
    expect(select.value).toBe("two");

    // 选项已全部挂载，后续信号更新会在同一个 select 上切换选中项。
    setDisabled(false);
    setValue("one");
    expect(input.disabled).toBe(false);
    expect(select.value).toBe("one");
    dispose();
  });

  it.skip("通过 bindProperty 驱动响应式 class、aria-label、disabled、value 与 checked，保持输入框同值光标不重置", () => {
    const [active, setActive] = createSignal(false);
    const [text, setText] = createSignal("hello");
    const [checked, setChecked] = createSignal(false);

    const { code, value: view } = evaluateCompiledModule<() => Node>(
      `
        const __result = () => (
          <div>
            <input
              id={dynamicId}
              class={() => (active() ? "ns-input active" : "ns-input")}
              aria-label={() => (active() ? "激活输入" : "普通输入")}
              value={() => text()}
              checked={() => checked()}
            />
            <button disabled={() => !active()}>保存</button>
          </div>
        );
      `,
      { active, text, checked, dynamicId: undefined },
    );
    expect(code).toContain("bindProperty as _bindProperty");

    const container = document.createElement("div");
    const unmount = render(view, container);

    const input = container.querySelector("input")!;
    const button = container.querySelector("button")!;

    // undefined 的动态 id 不应把属性写成字符串 "undefined"。
    expect(input.id).toBe("");
    expect(input.className).toBe("ns-input");
    expect(input.getAttribute("aria-label")).toBe("普通输入");
    expect(input.value).toBe("hello");
    expect(input.checked).toBe(false);
    expect(button.disabled).toBe(true);

    // 模拟输入值未变时写入信号：value setter 不会重复触发，避免重置输入光标。
    const valueSetter = vi.spyOn(HTMLInputElement.prototype, "value", "set");
    setActive(true);
    setChecked(true);
    expect(input.className).toBe("ns-input active");
    expect(input.getAttribute("aria-label")).toBe("激活输入");
    expect(input.checked).toBe(true);
    expect(button.disabled).toBe(false);
    expect(valueSetter).not.toHaveBeenCalled();

    setText("world");
    expect(input.value).toBe("world");
    expect(valueSetter).toHaveBeenCalledTimes(1);
    valueSetter.mockRestore();

    // 卸载后所有响应式属性订阅全部释放。
    unmount();
    setActive(false);
    expect(input.className).toBe("ns-input active");
  });

  it.skip("事件绑定先求值一次并配合 onCleanup 成对移除监听，同时安全忽略 undefined 回调", () => {
    const clicks: string[] = [];
    const inputs: string[] = [];
    const changes: boolean[] = [];
    let factoryCalls = 0;

    const { code, value: view } = evaluateCompiledModule<() => Node>(
      `
        const __result = () => (
          <div>
            <button id="b1" onClick={makeClickHandler()}>点我</button>
            <button id="b2" onClick={missingHandler}>空事件</button>
            <input id="t1" type="text" onInput={(e) => inputs.push(e.currentTarget.value)} />
            <input id="c1" type="checkbox" onChange={(e) => changes.push(e.currentTarget.checked)} />
          </div>
        );
      `,
      {
        makeClickHandler: () => {
          factoryCalls += 1;
          return () => clicks.push("clicked");
        },
        missingHandler: undefined,
        inputs,
        changes,
      },
    );

    expect(code).toContain("onCleanup as _onCleanup");
    expect(code).toContain('addEventListener("click"');
    expect(code).toContain('removeEventListener("click"');

    const container = document.createElement("div");
    const unmount = render(view, container);

    // onClick={makeClickHandler()} 只能求值一次，注册与解绑必须持有同一函数引用。
    expect(factoryCalls).toBe(1);

    const b1 = container.querySelector<HTMLButtonElement>("#b1")!;
    const b2 = container.querySelector<HTMLButtonElement>("#b2")!;
    const t1 = container.querySelector<HTMLInputElement>("#t1")!;
    const c1 = container.querySelector<HTMLInputElement>("#c1")!;

    b1.click();
    b2.click();
    t1.value = "abc";
    t1.dispatchEvent(new Event("input"));
    c1.checked = true;
    c1.dispatchEvent(new Event("change"));

    expect(clicks).toEqual(["clicked"]);
    expect(inputs).toEqual(["abc"]);
    expect(changes).toEqual([true]);

    // 卸载后全部事件监听均已移除。
    unmount();
    b1.click();
    t1.value = "def";
    t1.dispatchEvent(new Event("input"));
    c1.checked = false;
    c1.dispatchEvent(new Event("change"));

    expect(clicks).toEqual(["clicked"]);
    expect(inputs).toEqual(["abc"]);
    expect(changes).toEqual([true]);
  });

  it.skip("无论 ref 写在属性列表何处，都在全部属性、事件与子节点挂载就绪后才调用", () => {
    const snapshots: Array<{ id: string; className: string; childText: string | null }> = [];
    const evalOrder: string[] = [];

    const { value: view } = evaluateCompiledModule<() => Node>(
      `
        const __result = () => (
          <div
            ref={recordRef()}
            id={recordId()}
            class="ready"
          >
            <span>已挂载子节点</span>
          </div>
        );
      `,
      {
        recordRef: () => {
          evalOrder.push("eval-ref");
          return (el: HTMLElement) => {
            evalOrder.push("call-ref");
            snapshots.push({
              id: el.id,
              className: el.className,
              childText: el.textContent,
            });
          };
        },
        recordId: () => {
          evalOrder.push("eval-id");
          return "box-1";
        },
      },
    );

    const container = document.createElement("div");
    const unmount = render(view, container);

    expect(evalOrder).toEqual(["eval-ref", "eval-id", "call-ref"]);
    expect(snapshots).toEqual([{ id: "box-1", className: "ready", childText: "已挂载子节点" }]);
    unmount();
  });

  it.skip("保留非目标标签的属性校验报错，并在后续属性或子节点抛错时沿 Owner 回滚已绑定的属性与事件", () => {
    const { value: invalidView } = evaluateCompiledModule<() => Node>(
      `const __result = () => <div disabled={true}>bad</div>;`,
    );
    expect(() => render(invalidView, document.createElement("div"))).toThrow(
      'The "disabled" prop is not supported on <div>',
    );

    const [cls, setCls] = createSignal("a");
    let classRuns = 0;
    let clicked = 0;
    let capturedButton: HTMLButtonElement | undefined;

    const { value: throwingView } = evaluateCompiledModule<() => Node>(
      `
        const __result = () => (
          <button
            class={() => {
              onClassRun();
              return cls();
            }}
            onClick={onClick}
            ref={onRef}
          >
            {fail()}
          </button>
        );
      `,
      {
        cls,
        onClassRun: () => {
          classRuns += 1;
        },
        onClick: () => {
          clicked += 1;
        },
        onRef: (el: HTMLButtonElement) => {
          capturedButton = el;
        },
        fail: () => {
          throw new Error("child exploded");
        },
      },
    );

    expect(() => render(throwingView, document.createElement("div"))).toThrow("child exploded");
    expect(classRuns).toBe(1);
    expect(capturedButton).toBeUndefined();

    // 构造中途抛错后，先前注册的 class effect 已被当前 Owner 回滚释放。
    setCls("b");
    expect(classRuns).toBe(1);
    expect(clicked).toBe(0);
  });

  it.skip("遇到未知属性、展开属性或重复属性时安全回退给 JSX，同时继续编译混合树与控制流内部的原生标签", () => {
    const source = `
      const view = (
        <section class="ns-card">
          <div data-custom="keep">
            <span class="inner">未知属性内仍编译</span>
          </div>
          <div class="a" class="b">
            <em class="dup">重复属性内仍编译</em>
          </div>
          <Show when={open} fallback={() => <p class="ns-empty">空</p>}>
            {() => <p id="detail">{() => text()}</p>}
          </Show>
        </section>
      );
    `;
    const result = transformJSX(source);
    expect(result).not.toBeNull();

    // 含未知属性、重复属性的元素和 <Show> 保留 JSX 交给运行时。
    expect(result!.code).toContain('<div data-custom="keep">');
    expect(result!.code).toContain('<div class="a" class="b">');
    expect(result!.code).toContain("<Show ");

    // 外层 <section> 与所有嵌套在未知属性、重复属性及 <Show> 懒工厂中的原生标签全部直接编译。
    expect(result!.code).toContain('document.createElement("section")');
    expect(result!.code).toContain('document.createElement("span")');
    expect(result!.code).toContain('document.createElement("em")');
    expect(result!.code).toContain('document.createElement("p")');
    expect(result!.code).toContain('.className = "ns-empty"');
    expect(result!.code).toContain('.id = "detail"');
  });

  it.skip("能够直接编译完整的 examples/todo-app/App.tsx：所有原生 HTML 标签全部直出，仅保留 For 与 Show 组件 JSX", () => {
    const todoSource = readFileSync(resolve(process.cwd(), "examples/todo-app/App.tsx"), "utf8");
    const result = transformJSX(todoSource, { filename: "examples/todo-app/App.tsx" });
    expect(result).not.toBeNull();

    // 整个文件仅注入一条 compiler-runtime 导入语句。
    const runtimeImports =
      result!.code.match(/^import\s[\s\S]*?from\s"#nano-solid\/compiler-runtime";/gm) ?? [];
    expect(runtimeImports.length).toBe(1);

    // 通过 AST 检查编译产物中剩余的 JSXElement，确认所有原生 HTML 标签均已直出，仅剩控制流组件 For 与 Show。
    const outputAst = parse(result!.code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
    const remainingTags: string[] = [];
    traverse(outputAst, {
      JSXOpeningElement(path) {
        if (t.isJSXIdentifier(path.node.name)) {
          remainingTags.push(path.node.name.name);
        }
      },
    });
    expect(remainingTags).toEqual(["For", "Show", "Show"]);
  });
});
