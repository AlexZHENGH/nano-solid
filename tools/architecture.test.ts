import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  checkArchitectureRules,
  extractModuleEdges,
  findCycles,
  listSourceFiles,
  type ArchitectureRule,
  type DependencyEdge,
} from "./dependency-graph.ts";

const ROOT_DIR = process.cwd();

/** 浏览器运行时层文件集合：严禁反向依赖编译器或 Node 专属包。 */
const BROWSER_RUNTIME_FILES = new Set([
  "src/reactive.ts",
  "src/dom.ts",
  "src/control-flow.ts",
  "src/jsx-runtime.ts",
  "src/compiler-runtime.ts",
  "src/index.ts",
]);

/** 仓库当前生效的架构边界规则集。 */
const REPO_ARCHITECTURE_RULES: ArchitectureRule[] = [
  {
    name: "reactive-core-zero-dependencies",
    matchFrom: (file) => file === "src/reactive.ts",
    checkEdge: (edge) => `响应式内核 src/reactive.ts 必须保持零依赖，禁止导入 "${edge.specifier}"`,
  },
  {
    name: "browser-runtime-no-compiler-or-node-deps",
    matchFrom: (file) => BROWSER_RUNTIME_FILES.has(file),
    checkEdge: (edge) => {
      if (
        edge.resolvedTo?.startsWith("src/compiler/") ||
        edge.resolvedTo === "src/vite.ts" ||
        edge.specifier.startsWith("@babel/") ||
        edge.specifier === "vite" ||
        edge.specifier.startsWith("node:")
      ) {
        return `浏览器运行时层禁止依赖编译器或 Node 模块 "${edge.specifier}"`;
      }
      return null;
    },
  },
  {
    name: "framework-src-no-upward-deps",
    matchFrom: (file) => file.startsWith("src/"),
    checkEdge: (edge) => {
      if (
        edge.resolvedTo?.startsWith("examples/") ||
        edge.resolvedTo?.startsWith("docs/") ||
        edge.resolvedTo?.startsWith("tools/") ||
        edge.specifier === "vitest"
      ) {
        return `框架源码 src/ 禁止反向依赖上层应用、工具或测试包 "${edge.specifier}"`;
      }
      return null;
    },
  },
  {
    name: "examples-only-public-package-entry",
    matchFrom: (file) => file.startsWith("examples/"),
    checkEdge: (edge) => {
      if (edge.resolvedTo?.startsWith("src/")) {
        return `示例应用禁止通过相对路径直接触碰框架源码 "${edge.specifier}"，请改用公开包名 "nano-solid"`;
      }
      if (edge.specifier.startsWith("#nano-solid")) {
        return `示例应用禁止继续使用已废弃的私有导入 "${edge.specifier}"`;
      }
      if (
        edge.specifier.startsWith("nano-solid/dist/") ||
        edge.specifier.startsWith("nano-solid/src/")
      ) {
        return `示例应用禁止深层穿越包内部路径 "${edge.specifier}"`;
      }
      return null;
    },
  },
];

describe("基于 Babel AST 的依赖图架构守卫", () => {
  it("精确解析静态 import、多行重导出、通配重导出、import type 与动态 import()，且不被注释和字符串误导", () => {
    const sample = `
      // 注释里的假导入绝不能被误判：
      // import { leak } from "../../src/reactive.ts";
      /* export * from "evil-pkg"; */
      const fake1 = 'import { x } from "../../src/dom.ts"';
      const fake2 = \`export { y } from "nano-solid/dist/reactive.js"\`;

      import { createSignal, type Dispose } from "nano-solid";
      import type { Todo } from "./types.ts";
      import { type OnlyTypeA, type OnlyTypeB } from "./more-types.ts";
      import "./side-effect.ts";
      export {
        alpha,
        beta,
      } from "./helpers.ts";
      export type { Gamma } from "./gamma.ts";
      export * from "./reexport-all.ts";

      export async function loadLazy() {
        const dynamicExpr = "./not-static.ts";
        await import(dynamicExpr);
        return import("./lazy-panel.tsx");
      }
    `;

    const edges = extractModuleEdges(sample, "examples/todo-app/App.tsx");
    expect(
      edges.map((edge) => ({
        specifier: edge.specifier,
        resolvedTo: edge.resolvedTo,
        kind: edge.kind,
        typeOnly: edge.typeOnly,
      })),
    ).toEqual([
      { specifier: "nano-solid", resolvedTo: null, kind: "import", typeOnly: false },
      {
        specifier: "./types.ts",
        resolvedTo: "examples/todo-app/types.ts",
        kind: "import",
        typeOnly: true,
      },
      {
        specifier: "./more-types.ts",
        resolvedTo: "examples/todo-app/more-types.ts",
        kind: "import",
        typeOnly: true,
      },
      {
        specifier: "./side-effect.ts",
        resolvedTo: "examples/todo-app/side-effect.ts",
        kind: "import",
        typeOnly: false,
      },
      {
        specifier: "./helpers.ts",
        resolvedTo: "examples/todo-app/helpers.ts",
        kind: "export-named",
        typeOnly: false,
      },
      {
        specifier: "./gamma.ts",
        resolvedTo: "examples/todo-app/gamma.ts",
        kind: "export-named",
        typeOnly: true,
      },
      {
        specifier: "./reexport-all.ts",
        resolvedTo: "examples/todo-app/reexport-all.ts",
        kind: "export-all",
        typeOnly: false,
      },
      {
        specifier: "./lazy-panel.tsx",
        resolvedTo: "examples/todo-app/lazy-panel.tsx",
        kind: "dynamic-import",
        typeOnly: false,
      },
    ]);

    // 每条边都附带 1-based 源码行号。
    expect(edges.every((edge) => edge.line > 0)).toBe(true);
  });

  it("三色 DFS 正确区分菱形 DAG 与真实有向环，并支持忽略或包含纯类型环", () => {
    const edge = (from: string, to: string, typeOnly = false): DependencyEdge => ({
      from,
      specifier: `./${to}`,
      resolvedTo: to,
      kind: "import",
      typeOnly,
      line: 1,
    });

    // 1. 菱形 DAG（a -> b, a -> c, b -> d, c -> d）不是环，必须返回空数组。
    const diamond = new Map<string, DependencyEdge[]>([
      ["a.ts", [edge("a.ts", "b.ts"), edge("a.ts", "c.ts")]],
      ["b.ts", [edge("b.ts", "d.ts")]],
      ["c.ts", [edge("c.ts", "d.ts")]],
      ["d.ts", []],
    ]);
    expect(findCycles(diamond)).toEqual([]);

    // 2. 三元运行时环（c -> a -> b -> c）应规范化为从字典序最小节点 a.ts 出发且只报告一次。
    const runtimeCycle = new Map<string, DependencyEdge[]>([
      ["c.ts", [edge("c.ts", "a.ts")]],
      ["a.ts", [edge("a.ts", "b.ts")]],
      ["b.ts", [edge("b.ts", "c.ts")]],
    ]);
    expect(findCycles(runtimeCycle)).toEqual([["a.ts", "b.ts", "c.ts", "a.ts"]]);

    // 3. 纯类型环：默认运行时模式忽略，开启 includeTypeOnly: true 时检出。
    const typeOnlyCycle = new Map<string, DependencyEdge[]>([
      ["x.ts", [edge("x.ts", "y.ts", true)]],
      ["y.ts", [edge("y.ts", "x.ts", false)]],
    ]);
    expect(findCycles(typeOnlyCycle)).toEqual([]);
    expect(findCycles(typeOnlyCycle, { includeTypeOnly: true })).toEqual([
      ["x.ts", "y.ts", "x.ts"],
    ]);
  });

  it("架构规则引擎能精准拦截跨层越界导入并报告规则名、文件、行号与非法说明符", () => {
    const badGraph = new Map<string, DependencyEdge[]>([
      [
        "examples/todo-app/BadView.tsx",
        extractModuleEdges(
          `
            import { createSignal } from "../../src/reactive.ts";
            import { render } from "nano-solid/dist/dom.js";
            import { For } from "#nano-solid";
          `,
          "examples/todo-app/BadView.tsx",
        ),
      ],
      ["src/dom.ts", extractModuleEdges(`import { parse } from "@babel/parser";`, "src/dom.ts")],
    ]);

    const violations = checkArchitectureRules(badGraph, REPO_ARCHITECTURE_RULES);
    expect(violations).toHaveLength(4);
    expect(violations.map((v) => ({ rule: v.rule, from: v.from, specifier: v.specifier }))).toEqual(
      [
        {
          rule: "examples-only-public-package-entry",
          from: "examples/todo-app/BadView.tsx",
          specifier: "../../src/reactive.ts",
        },
        {
          rule: "examples-only-public-package-entry",
          from: "examples/todo-app/BadView.tsx",
          specifier: "nano-solid/dist/dom.js",
        },
        {
          rule: "examples-only-public-package-entry",
          from: "examples/todo-app/BadView.tsx",
          specifier: "#nano-solid",
        },
        {
          rule: "browser-runtime-no-compiler-or-node-deps",
          from: "src/dom.ts",
          specifier: "@babel/parser",
        },
      ],
    );
  });

  it("仓库真实 src/ 与 examples/todo-app/ 生产源码完全满足架构分层边界规则", () => {
    const files = listSourceFiles(ROOT_DIR, ["src", "examples/todo-app"]);
    expect(files.length).toBeGreaterThan(0);

    const graph = buildDependencyGraph(files, ROOT_DIR);
    const violations = checkArchitectureRules(graph, REPO_ARCHITECTURE_RULES);
    expect(violations).toEqual([]);
  });

  it("仓库真实 src/ 与 examples/todo-app/ 生产源码不存在任何循环依赖（含纯类型导入）", () => {
    const files = listSourceFiles(ROOT_DIR, ["src", "examples/todo-app"]);
    const graph = buildDependencyGraph(files, ROOT_DIR);
    const cycles = findCycles(graph, { includeTypeOnly: true });
    expect(cycles).toEqual([]);
  });
});
