// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
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

  it("保留函数组件与暂未覆盖的带属性/动态表达式原生标签，但继续编译组件内部支持的静态子树", () => {
    const source = `
      function App() {
        return (
          <Card>
            <div>静态内容</div>
            <button id="keep-jsx">带属性交运行时</button>
          </Card>
        );
      }
    `;
    const result = transformJSX(source);
    expect(result).not.toBeNull();
    // 外层 <Card> 与带 id 属性的 <button> 保留 JSX 交给运行时。
    expect(result!.code).toContain("<Card>");
    expect(result!.code).toContain('<button id="keep-jsx">');
    // 内部的无属性静态 <div> 已被直接编译，且作为 <Card> 子节点包在 JSX 表达式容器 {} 中。
    expect(result!.code).toContain('document.createElement("div")');
    expect(result!.code).toContain('document.createTextNode("静态内容")');
  });

  it("当源码中没有任何可编译的原生 JSX 时返回 null，避免无谓改写", () => {
    expect(transformJSX("export const x = 1 + 2;")).toBeNull();
    expect(transformJSX("const el = <Counter />;")).toBeNull();
    expect(transformJSX('const el = <div id="a" />;')).toBeNull();
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
  it.skip("把函数字面量子节点编译为 createReactiveText，并保持普通表达式 {count()} 只求值一次的静态快照语义", () => {
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

  it.skip("通过 appendChildren 保持数字 0、布尔/空值、嵌套数组、原生 Node、DocumentFragment 与函数变量的运行时等价性", () => {
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

  it.skip("纯静态 JSX 不注入任何 import；多处动态表达式只合并注入一条 import 并支持自定义 runtimeModule", () => {
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

  it.skip("当用户代码在模块顶层或嵌套函数内声明了同名标识符时，生成的辅助导入别名与局部变量均不发生冲突", () => {
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

  it.skip("已编译的原生容器内嵌组件或未支持子元素时，通过 appendChildren 委托外层同时继续编译其内部受支持的原生子树", () => {
    const source = `
      const view = (
        <section>
          <Card>
            <span>组件内部文本</span>
          </Card>
          <button id="later">
            <strong>外层交运行时内层仍编译</strong>
          </button>
        </section>
      );
    `;
    const result = transformJSX(source);
    expect(result).not.toBeNull();

    // 外层 <section> 已编译并通过 _appendChildren 挂载 <Card> 和 <button id="later">。
    expect(result!.code).toContain('document.createElement("section")');
    expect(result!.code).toContain("appendChildren as _appendChildren");
    expect(result!.code).toContain("<Card>");
    expect(result!.code).toContain('<button id="later">');

    // 更深层位于 <Card> 和 <button id="later"> 内部的 <span> 与 <strong> 也都被继续编译为直接 DOM 调用。
    expect(result!.code).toContain('document.createElement("span")');
    expect(result!.code).toContain('document.createTextNode("组件内部文本")');
    expect(result!.code).toContain('document.createElement("strong")');
    expect(result!.code).toContain('document.createTextNode("外层交运行时内层仍编译")');
  });

  it.skip("动态子节点在构造中途抛错时，沿当前 Owner 回滚已建立的响应式文本订阅", () => {
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
