import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

/** 单条静态模块依赖边：记录来源文件、原始说明符、解析后的仓内相对路径、语法种类、是否纯类型导入与行号。 */
export type DependencyEdge = {
  /** 发起导入的文件（相对仓库根、统一正斜杠）。 */
  from: string;
  /** 源码里书写的原始模块说明符（如 "./reactive.ts" 或 "nano-solid"）。 */
  specifier: string;
  /** 若为相对路径，记录相对仓库根归一化后的正斜杠路径；外部包或裸包名为 null。 */
  resolvedTo: string | null;
  /** 语法来源：静态 import、命名重导出、通配重导出或静态字面量动态 import()。 */
  kind: "import" | "export-named" | "export-all" | "dynamic-import";
  /** 是否为纯类型导入或重导出（运行时会被 TypeScript 擦除）。 */
  typeOnly: boolean;
  /** 该语句或表达式在源文件中的起始行号（1-based）。 */
  line: number;
};

/** 一条声明式的架构边界规则。 */
export type ArchitectureRule = {
  /** 规则名称，用于违例报告定位。 */
  name: string;
  /** 判断来源文件是否受本条规则约束。 */
  matchFrom: (fromFile: string) => boolean;
  /** 返回错误说明字符串表示违例；返回 null 表示通过。 */
  checkEdge: (edge: DependencyEdge) => string | null;
};

/** 架构规则校验产出的一条违例记录。 */
export type ArchitectureViolation = {
  rule: string;
  from: string;
  line: number;
  specifier: string;
  message: string;
};

/** 循环依赖检测的可选配置。 */
export type FindCyclesOptions = {
  /** 是否把纯类型导入（import type / export type）也纳入环检测；默认 false（仅检查运行时环）。 */
  includeTypeOnly?: boolean;
};

/** 分层白名单中的一条依赖许可：字符串表示允许任意导入该层，对象形式表示只允许纯类型导入。 */
export type LayerDependency = string | { layer: string; typeOnly: true };

/** 生成分层白名单规则所需的配置。 */
export type LayerRuleOptions = {
  /** 规则名称，用于违例报告定位。 */
  name: string;
  /** 把仓内文件路径映射到层名；返回 null 表示该文件不属于任何层。 */
  classify: (file: string) => string | null;
  /** 每一层允许依赖的层或外部包名；未列出的依赖一律视为违例。 */
  allow: Readonly<Record<string, readonly LayerDependency[]>>;
};

/**
 * 递归扫描指定目录列表中的所有生产 TS / TSX 源文件（默认跳过测试文件），返回按字典序排列的正斜杠相对路径。
 *
 * @param rootDir 仓库根目录绝对路径。
 * @param dirs 要扫描的相对目录列表（如 ["src", "examples/todo-app"]）。
 * @returns 排序后的相对路径列表。
 */
export function listSourceFiles(rootDir: string, dirs: string[]): string[] {
  const results: string[] = [];

  function walk(absDir: string, relDir: string): void {
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const nextRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const nextAbs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-demos") {
          continue;
        }
        walk(nextAbs, nextRel);
        continue;
      }
      if (!/\.[tj]sx?$/.test(entry.name)) continue;
      if (/\.test\.[tj]sx?$/.test(entry.name)) continue;
      results.push(nextRel);
    }
  }

  for (const dir of dirs) {
    walk(resolve(rootDir, dir), dir.replace(/\\/g, "/"));
  }

  return results.sort((a, b) => a.localeCompare(b));
}

/**
 * 将相对导入说明符（./ 或 ../）按来源文件路径归一化为相对仓库根的正斜杠路径；非相对路径（如 "nano-solid"）返回 null。
 *
 * @param fromFile 发起导入的文件路径（相对仓库根、正斜杠）。
 * @param specifier 源码中书写的模块说明符。
 * @returns 归一化后的仓内相对路径，或 null。
 */
export function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }
  const fromDir = posix.dirname(fromFile.replace(/\\/g, "/"));
  return posix.normalize(posix.join(fromDir, specifier));
}

/**
 * 使用 Babel 8 AST 从单份 TS / TSX 源码中精确提取所有静态导入、重导出与字面量动态 import() 依赖边，
 * 自动免疫注释、字符串与模板字面量中的伪造导入文本。
 *
 * @param source 原始 TS / TSX 源码字符串。
 * @param fromFile 当前文件的仓内相对路径（正斜杠）。
 * @returns 该文件发出的全部依赖边列表。
 */
export function extractModuleEdges(source: string, fromFile: string): DependencyEdge[] {
  // 解析 AST 并遍历 ImportDeclaration、带 source 的 ExportNamedDeclaration、ExportAllDeclaration 与字面量动态 import()，准确标记 typeOnly 与行号。
  const normalizedFrom = fromFile.replace(/\\/g, "/");
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  const edges: DependencyEdge[] = [];
  const pushEdge = (
    specifier: string,
    kind: DependencyEdge["kind"],
    typeOnly: boolean,
    line: number,
  ): void => {
    edges.push({
      from: normalizedFrom,
      specifier,
      resolvedTo: resolveRelativeModule(normalizedFrom, specifier),
      kind,
      typeOnly,
      line,
    });
  };

  traverse(ast, {
    ImportDeclaration(path) {
      const node = path.node;
      const typeOnly =
        node.importKind === "type" ||
        (node.specifiers.length > 0 &&
          node.specifiers.every(
            (specifier) => t.isImportSpecifier(specifier) && specifier.importKind === "type",
          ));
      pushEdge(node.source.value, "import", typeOnly, node.loc?.start.line ?? 0);
    },
    ExportNamedDeclaration(path) {
      const node = path.node;
      if (!node.source) return;
      const typeOnly =
        node.exportKind === "type" ||
        (node.specifiers.length > 0 &&
          node.specifiers.every(
            (specifier) => t.isExportSpecifier(specifier) && specifier.exportKind === "type",
          ));
      pushEdge(node.source.value, "export-named", typeOnly, node.loc?.start.line ?? 0);
    },
    ExportAllDeclaration(path) {
      const node = path.node;
      pushEdge(
        node.source.value,
        "export-all",
        node.exportKind === "type",
        node.loc?.start.line ?? 0,
      );
    },
    ImportExpression(path) {
      const node = path.node;
      if (!t.isStringLiteral(node.source)) return;
      pushEdge(node.source.value, "dynamic-import", false, node.loc?.start.line ?? 0);
    },
  });

  return edges;
}

/**
 * 读取指定文件列表并构建完整仓内依赖图（邻接表：来源文件 -> 依赖边列表）。
 *
 * @param files 仓内相对文件路径列表。
 * @param rootDir 仓库根目录绝对路径。
 * @returns 以来源文件为键的依赖边邻接表。
 */
export function buildDependencyGraph(
  files: string[],
  rootDir: string,
): Map<string, DependencyEdge[]> {
  // 依次读取每个文件内容并调用 extractModuleEdges 填充邻接表。
  const graph = new Map<string, DependencyEdge[]>();
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    const source = readFileSync(resolve(rootDir, normalized), "utf8");
    graph.set(normalized, extractModuleEdges(source, normalized));
  }
  return graph;
}

/**
 * 使用三色深度优先搜索（0 未访问 / 1 正在当前递归栈中 / 2 已完成）检测依赖图中的所有有向环，
 * 将每条环规范化为从字典序最小节点出发的闭环路径并去重返回。
 *
 * @param graph 由 buildDependencyGraph 构建的模块依赖图。
 * @param options 是否包含纯类型导入边的配置（默认仅检查运行时值导入环）。
 * @returns 去重且确定性排序后的全部循环依赖路径（如 ["a.ts", "b.ts", "a.ts"]）。
 */
export function findCycles(
  graph: Map<string, DependencyEdge[]>,
  options?: FindCyclesOptions,
): string[][] {
  // 对图内节点执行三色 DFS：只有遇到“灰色（在当前栈中）”节点才构成环，避免把菱形 DAG 误判成环。
  const includeTypeOnly = options?.includeTypeOnly ?? false;
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const stackIndex = new Map<string, number>();
  const uniqueCycles = new Map<string, string[]>();

  const nodes = Array.from(graph.keys()).sort((a, b) => a.localeCompare(b));

  function canonicalizeCycle(rawCycle: string[]): string[] {
    let minIndex = 0;
    for (let i = 1; i < rawCycle.length; i += 1) {
      if (rawCycle[i]!.localeCompare(rawCycle[minIndex]!) < 0) {
        minIndex = i;
      }
    }
    const rotated = [...rawCycle.slice(minIndex), ...rawCycle.slice(0, minIndex)];
    return [...rotated, rotated[0]!];
  }

  function dfs(node: string): void {
    color.set(node, 1);
    stackIndex.set(node, stack.length);
    stack.push(node);

    const edges = graph.get(node) ?? [];
    for (const edge of edges) {
      if (!includeTypeOnly && edge.typeOnly) continue;
      const target = edge.resolvedTo;
      if (!target || !graph.has(target)) continue;

      const state = color.get(target) ?? 0;
      if (state === 1) {
        const startIdx = stackIndex.get(target);
        if (startIdx !== undefined) {
          const canonical = canonicalizeCycle(stack.slice(startIdx));
          uniqueCycles.set(canonical.join(" -> "), canonical);
        }
      } else if (state === 0) {
        dfs(target);
      }
    }

    stack.pop();
    stackIndex.delete(node);
    color.set(node, 2);
  }

  for (const node of nodes) {
    if ((color.get(node) ?? 0) === 0) {
      dfs(node);
    }
  }

  return Array.from(uniqueCycles.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, cycle]) => cycle);
}

/**
 * 按声明式规则集遍历依赖图中的每条边，收集全部架构违例报告。
 *
 * @param graph 模块依赖图。
 * @param rules 要执行的架构规则列表。
 * @returns 按来源文件与行号稳定排序后的违例数组。
 */
export function checkArchitectureRules(
  graph: Map<string, DependencyEdge[]>,
  rules: ArchitectureRule[],
): ArchitectureViolation[] {
  // 按确定顺序遍历所有来源文件、每条依赖边与匹配规则，汇总非空违例消息。
  const violations: ArchitectureViolation[] = [];
  const files = Array.from(graph.keys()).sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const matchingRules = rules.filter((rule) => rule.matchFrom(file));
    if (matchingRules.length === 0) continue;

    const edges = graph.get(file) ?? [];
    for (const edge of edges) {
      for (const rule of matchingRules) {
        const message = rule.checkEdge(edge);
        if (message !== null) {
          violations.push({
            rule: rule.name,
            from: file,
            line: edge.line,
            specifier: edge.specifier,
            message,
          });
        }
      }
    }
  }

  return violations.sort(
    (a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
}

/**
 * 根据“每层允许依赖谁”的白名单表生成一条架构规则。
 *
 * 只有被 classify 归入某一层的来源文件受约束。依赖目标是仓内文件时用 classify 求出所在层，
 * 是外部包时以包名（如 "nano-solid"、"@scope/pkg"）作为层名，再到来源层的白名单里查找许可。
 *
 * @param options 规则名称、文件归层函数与分层白名单表。
 * @returns 可直接交给 checkArchitectureRules 执行的架构规则。
 */
export function createLayerRule(options: LayerRuleOptions): ArchitectureRule {
  // 来源文件按 classify 归层；依赖目标按“仓内文件归层、外部包取包名”求出目标层，再按白名单与 typeOnly 许可逐条判定。
  const { name, classify, allow } = options;

  /**
   * 给相对路径和包导入取一个可用于查表的层名。
   * @param edge 当前检查的依赖边。
   * @returns 目标层名，仓内文件未归层时返回 null。
   */
  const resolveTargetLayer = (edge: DependencyEdge): string | null => {
    if (edge.resolvedTo !== null) return classify(edge.resolvedTo);

    // 作用域也是包名的一部分，不能把 @scope 下的所有包当成同一个包。
    const segments = edge.specifier.split("/");
    return edge.specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? null);
  };

  return {
    name,
    matchFrom: (file) => classify(file) !== null,
    checkEdge: (edge) => {
      // 只有来源归了层，才知道该查白名单里的哪一行。
      const fromLayer = classify(edge.from);
      if (fromLayer === null) return null;

      // 已受约束的文件如果导入未归层的目标，要指出缺的是哪一个模块。
      const targetLayer = resolveTargetLayer(edge);
      if (targetLayer === null) {
        return `${fromLayer} 层依赖了未归入任何层的模块 "${edge.specifier}"`;
      }

      // 只查来源层的许可。来源层没有配置时，默认禁止。
      const permission = (allow[fromLayer] ?? []).find((entry) =>
        typeof entry === "string" ? entry === targetLayer : entry.layer === targetLayer,
      );
      if (permission === undefined) {
        return `${fromLayer} 层不允许依赖 ${targetLayer} 层 "${edge.specifier}"`;
      }

      // 已经允许接触这一层，再确认这条导入有没有带进运行时的值。
      if (typeof permission !== "string" && !edge.typeOnly) {
        return `${fromLayer} 层只能用 import type 依赖 ${targetLayer} 层 "${edge.specifier}"`;
      }
      return null;
    },
  };
}
