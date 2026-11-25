import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  checkArchitectureRules,
  createLayerRule,
  extractModuleEdges,
  findCycles,
  listSourceFiles,
  type ArchitectureRule,
  type DependencyEdge,
  type LayerDependency,
} from "./dependency-graph.ts";

const ROOT_DIR = process.cwd();

/** 浏览器运行时层文件集合：严禁反向依赖编译器或 Node 专属包。 */
const BROWSER_RUNTIME_FILES = new Set([
  "src/reactive.ts",
  "src/async-resource.ts",
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

/** Todo 示例应用的源码根目录（相对仓库根，带结尾斜杠）。 */
const TODO_APP_ROOT = "examples/todo-app/";

/**
 * 把 Todo 示例应用的文件归入所属层，不属于 Todo 应用或尚未归类的文件返回 null。
 *
 * @param file 相对仓库根的正斜杠路径。
 * @returns 层名或 null。
 */
function classifyTodoFile(file: string): string | null {
  if (!file.startsWith(TODO_APP_ROOT)) return null;
  const relPath = file.slice(TODO_APP_ROOT.length);

  // 领域类型与存储协议：纯 TypeScript，不依赖框架。
  if (relPath === "types.ts") return "types";
  if (relPath === "storage.ts") return "storage";
  // 具体存储实现：只实现 storage.ts 定义的协议。
  if (relPath.startsWith("adapters/")) return "adapters";
  // 领域状态：用 nano-solid 管理响应式状态与自动保存。
  if (relPath === "todo-store.ts") return "store";
  // 视图：纯展示组件与根视图。
  if (relPath.startsWith("components/")) return "components";
  if (relPath === "App.tsx") return "app";
  // 组合根：应用入口与测试装配，负责把具体实现接到一起。
  if (relPath === "main.tsx" || relPath.startsWith("test-support/")) return "entry";
  return null;
}

/** Todo 示例应用的分层白名单：每一层只能依赖表中列出的层或外部包。 */
const TODO_APP_LAYERS = {
  types: [],
  storage: ["types"],
  adapters: ["storage", "types"],
  store: ["storage", "types", "nano-solid"],
  components: ["components", "types", "nano-solid"],
  app: ["components", { layer: "store", typeOnly: true }, "types", "nano-solid"],
  entry: ["entry", "app", "store", "adapters", "storage", "types", "nano-solid"],
} satisfies Record<string, readonly LayerDependency[]>;

/**
 * 生成 Todo 示例应用的分层白名单规则。
 *
 * @returns 可交给 checkArchitectureRules 执行的架构规则。
 */
function createTodoAppLayerRule(): ArchitectureRule {
  return createLayerRule({
    name: "todo-app-layers",
    classify: classifyTodoFile,
    allow: TODO_APP_LAYERS,
  });
}

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

describe("分层白名单规则", () => {
  it("只放行白名单内的依赖，拦截未授权的层、未归类的模块、未列出的外部包与越权的值导入", () => {
    // 一张与 Todo 无关的最小分层表：ui 可依赖 domain、nano-solid，只能以类型方式依赖 infra。
    const rule = createLayerRule({
      name: "demo-layers",
      classify: (file) => {
        if (file.startsWith("app/ui/")) return "ui";
        if (file.startsWith("app/domain/")) return "domain";
        if (file.startsWith("app/infra/")) return "infra";
        return null;
      },
      allow: {
        ui: ["domain", { layer: "infra", typeOnly: true }, "nano-solid", "@scope/pkg"],
        domain: [],
        infra: ["domain"],
      },
    });

    // 用真正的导入语句构造依赖边，同一张图同时包含允许和违规的导入。
    const graph = new Map<string, DependencyEdge[]>([
      [
        "app/ui/View.tsx",
        extractModuleEdges(
          `
            import { createSignal } from "nano-solid";
            import { helper } from "@scope/pkg/sub";
            import { createTask } from "../domain/task.ts";
            import type { Client } from "../infra/client.ts";
            import { createClient } from "../infra/client.ts";
            import { run } from "../../scripts/run.ts";
          `,
          "app/ui/View.tsx",
        ),
      ],
      [
        "app/domain/task.ts",
        extractModuleEdges(
          `
            import { View } from "../ui/View.tsx";
            import { debounce } from "lodash";
          `,
          "app/domain/task.ts",
        ),
      ],
      // 未归层的来源文件不受本规则约束。
      [
        "scripts/run.ts",
        extractModuleEdges(`import { View } from "../app/ui/View.tsx";`, "scripts/run.ts"),
      ],
    ]);

    // 对照所有违规位置，也确保白名单允许的导入没有被误报。
    const violations = checkArchitectureRules(graph, [rule]);
    expect(violations.map((v) => ({ from: v.from, line: v.line, specifier: v.specifier }))).toEqual(
      [
        { from: "app/domain/task.ts", line: 2, specifier: "../ui/View.tsx" },
        { from: "app/domain/task.ts", line: 3, specifier: "lodash" },
        { from: "app/ui/View.tsx", line: 6, specifier: "../infra/client.ts" },
        { from: "app/ui/View.tsx", line: 7, specifier: "../../scripts/run.ts" },
      ],
    );
    expect(violations.every((v) => v.rule === "demo-layers")).toBe(true);

    // 违例说明要能直接指出问题：越层、只允许类型导入、目标未归层。
    const messages = violations.map((v) => v.message);
    expect(messages[0]).toContain("domain");
    expect(messages[0]).toContain("ui");
    expect(messages[2]).toContain("import type");
    expect(messages[3]).toContain("未归入任何层");
  });

  it("Todo 示例应用的每个生产文件都已归层，且真实依赖完全符合分层白名单", () => {
    // 先确认扫描到了应用源码，避免入口目录改名后对着空图通过。
    const files = listSourceFiles(ROOT_DIR, ["examples/todo-app"]);
    expect(files.length).toBeGreaterThan(0);

    // 新增文件必须先在 classifyTodoFile 里归层，否则会悄悄逃出规则约束。
    expect(files.filter((file) => classifyTodoFile(file) === null)).toEqual([]);

    // 用与日常测试相同的依赖图引擎检查每个已归层文件发出的导入。
    const graph = buildDependencyGraph(files, ROOT_DIR);
    const violations = checkArchitectureRules(graph, [createTodoAppLayerRule()]);
    expect(violations).toEqual([]);
  });
});
