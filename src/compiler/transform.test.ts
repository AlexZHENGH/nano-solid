// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { normalizeJSXText, transformJSX } from "./transform.ts";

/** 执行编译后的纯表达式代码并返回生成的 DOM 节点（用于验证运行时结果）。 */
function evaluateCompiledExpression(source: string): Node {
  const result = transformJSX(`const view = ${source};`, { filename: "test.tsx" });
  expect(result).not.toBeNull();
  const factory = new Function(`${result!.code}\nreturn view;`) as () => Node;
  return factory();
}

describe("静态原生 JSX 编译器", () => {
  it.skip("把静态原生标签与纯文本编译为直接 DOM 创建与插入调用，不依赖 jsx 运行时", () => {
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

  it.skip("把多层嵌套的静态原生标签展平编译进同一个 IIFE，执行后生成等价 DOM 树", () => {
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

  it.skip('遵循标准 JSX 空白规则：保留同行空格与显式 {" "}，裁掉跨行缩进并忽略 JSX 注释', () => {
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

  it.skip("保留函数组件与暂未覆盖的带属性/动态表达式原生标签，但继续编译组件内部支持的静态子树", () => {
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

  it.skip("当源码中没有任何可编译的原生 JSX 时返回 null，避免无谓改写", () => {
    expect(transformJSX("export const x = 1 + 2;")).toBeNull();
    expect(transformJSX("const el = <Counter />;")).toBeNull();
    expect(transformJSX('const el = <div id="a" />;')).toBeNull();
  });

  it.skip("编译后的输出附带有效 source map", () => {
    const result = transformJSX("const el = <span>hi</span>;", { filename: "sample.tsx" });
    expect(result).not.toBeNull();
    expect(result!.map).not.toBeNull();
    expect(result!.map?.sources).toContain("sample.tsx");
    expect(result!.map?.mappings.length).toBeGreaterThan(0);
  });
});
