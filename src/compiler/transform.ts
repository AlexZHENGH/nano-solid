import generate from "@babel/generator";
import { parse } from "@babel/parser";
import traverse, { type Scope } from "@babel/traverse";
import * as t from "@babel/types";

/** JSX 编译器的可选配置。 */
export type TransformOptions = {
  /** 源文件名，用于生成指向原 TSX 行号的 source map。 */
  filename?: string;
  /** 编译期辅助函数的导入路径（仓内默认 "#nano-solid/compiler-runtime"）。 */
  runtimeModule?: string;
};

/** JSX 编译器的输出结果：包含改写后的代码与对应的 source map。 */
export type TransformResult = {
  code: string;
  map: ReturnType<typeof generate>["map"];
};

/**
 * 按标准 JSX 空白折叠规则清洗 JSXText：保留单行内的原始空格，跨行时去掉换行缩进并用单个空格连接非空行。
 *
 * @param raw JSXText 节点的原始字符串。
 * @returns 折叠空白后的文本；若全为空白缩进则返回空字符串。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
export function normalizeJSXText(raw: string): string {
  // 按换行拆分，对非首行去前导空白、对非末行去尾随空白，过滤空行后以单个空格连接。
  // TODO: 实现标准 JSX 空白折叠逻辑。
  return raw;
}

/**
 * 判断一个 JSXElement 子树当前是否可以安全编译为直接 DOM 调用：
 * 仅处理无属性的小写原生 HTML 标签，且其子节点均为静态文本、JSX 注释、字符串字面量表达式或同样可编译的子元素。
 *
 * @param element 待检查的 JSXElement AST 节点。
 * @returns 是否支持整棵子树直接编译。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function canCompileElement(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  element: t.JSXElement,
): boolean {
  // 检查小写原生标签名、空属性列表以及全部子节点类型（JSXText / JSXEmptyExpression / StringLiteral / 递归 JSXElement）。
  // TODO: 实现静态原生 JSX 子树的编译能力判定。
  return false;
}

/**
 * 递归把可编译的静态原生 JSXElement 编译为语句序列，并把当前元素节点追加到父级语句列表中。
 *
 * @param element 已通过 canCompileElement 校验的 JSXElement。
 * @param scope 当前 Babel 作用域，用于生成不冲突的唯一变量名。
 * @param statements 用于收集本棵子树所有 DOM 构造语句的数组。
 * @returns 代表当前已创建 DOM 元素的局部变量标识符。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function emitElement(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  element: t.JSXElement,
  scope: Scope,
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  statements: t.Statement[],
): t.Identifier {
  // 生成唯一变量 _el = document.createElement(tag)，遍历子节点直出 createTextNode 或递归 emitElement 并 appendChild。
  // TODO: 实现静态元素与嵌套子元素的扁平 DOM 语句生成。
  return scope.generateUidIdentifier("el");
}

/**
 * 将 TSX 源码中可静态确定的原生 JSX 子树直接编译为原生 DOM 操作；若文件中没有发生任何改写，返回 null。
 *
 * @param source 原始 TypeScript / TSX 源码字符串。
 * @param options 可选文件名与运行时模块路径配置。
 * @returns 编译后的代码与 source map；未改动时返回 null。
 */
export function transformJSX(
  source: string,
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  options?: TransformOptions,
): TransformResult | null {
  // 1. 使用 @babel/parser 开启 jsx 与 typescript 插件把源码解析为 AST。
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  let changed = false;

  // 2. 遍历 AST 中的 JSXElement：不支持编译的节点保持原样并继续深入子孙；支持的节点编成扁平 IIFE 并调用 path.skip()。
  traverse(ast, {
    JSXElement(
      // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
      path,
    ) {
      // 检查 canCompileElement(path.node)，生成扁平 IIFE 替换当前节点（若父节点仍是 JSX 则包一层 JSXExpressionContainer）并标记 changed = true。
      // TODO: 实现 JSXElement 访问器的子树替换逻辑。
    },
  });

  // 3. 若整份文件没有任何节点被编译，返回 null 让上层 Vite 插件直接跳过。
  if (!changed) {
    return null;
  }

  // 4. 使用 @babel/generator 生成代码与 source map。
  const output = generate(ast, {
    sourceMaps: true,
    sourceFileName: options?.filename ?? "input.tsx",
  });
  return {
    code: output.code,
    map: output.map,
  };
}
