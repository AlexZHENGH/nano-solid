import generate from "@babel/generator";
import { parse } from "@babel/parser";
import traverse, { type Scope } from "@babel/traverse";
import * as t from "@babel/types";

/** 仓内开发阶段编译器默认注入的运行时辅助模块路径。 */
const DEFAULT_RUNTIME_MODULE = "#nano-solid/compiler-runtime";

/** 编译器当前按需导入的运行时辅助函数名集合。 */
type RuntimeHelper = "createReactiveText" | "appendChildren";

/** 递归生成 DOM 语句时共享的作用域与按需导入登记器。 */
type EmitContext = {
  scope: Scope;
  useHelper: (name: RuntimeHelper) => t.Identifier;
};

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
export function normalizeJSXText(raw: string): string {
  // 按换行拆分，对非首行去前导空白、对非末行去尾随空白，过滤空行后以单个空格连接。
  return raw
    .split(/\r\n|\n|\r/)
    .map((line, index, lines) => {
      let trimmed = line;
      if (index > 0) trimmed = trimmed.replace(/^[ \t]+/, "");
      if (index < lines.length - 1) trimmed = trimmed.replace(/[ \t]+$/, "");
      return trimmed;
    })
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * 判断子节点表达式在编译期是否已确定为无参同步函数字面量（如 () => count()），可直接编译为 createReactiveText。
 *
 * @param expr JSXExpressionContainer 中的表达式 AST 节点。
 * @returns 是否可直接交由 createReactiveText 处理。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function isReactiveTextGetter(expr: t.Expression): boolean {
  // 仅匹配无参、非 async、非 generator 的箭头函数或函数表达式，不改变 {count()} 等普通表达式的单次求值语义。
  // TODO: 实现 isReactiveTextGetter
  return false;
}

/**
 * 判断一个 JSXElement 当前是否可以安全编译为直接 DOM 调用：
 * 当前支持无属性的小写原生 HTML 标签，其子节点允许文本、表达式容器以及任意子元素（未支持的子元素通过 appendChildren 交由运行时并在后续遍历中继续编译）。
 *
 * @param element 待检查的 JSXElement AST 节点。
 * @returns 是否支持把该原生元素编译为直接 DOM 调用。
 */
function canCompileElement(element: t.JSXElement): boolean {
  const opening = element.openingElement;
  if (!t.isJSXIdentifier(opening.name)) return false;
  if (!/^[a-z]/.test(opening.name.name)) return false;
  if (opening.attributes.length > 0) return false;

  // 允许 JSXText、JSXExpressionContainer 以及任意 JSXElement 子节点（排除 JSXFragment 与 JSXSpreadChild）。
  // TODO: 放宽子元素与表达式容器校验，支持任意 JSXElement 与 JSXExpressionContainer 子节点
  return element.children.every((child) => {
    if (t.isJSXText(child)) return true;
    if (t.isJSXElement(child)) return canCompileElement(child);
    if (t.isJSXExpressionContainer(child)) {
      return t.isJSXEmptyExpression(child.expression) || t.isStringLiteral(child.expression);
    }
    return false;
  });
}

/**
 * 递归把可编译的原生 JSXElement 编译为语句序列，并把当前元素节点追加到父级语句列表中。
 *
 * @param element 已通过 canCompileElement 校验的 JSXElement。
 * @param context 包含作用域与按需导入登记器的编译上下文。
 * @param statements 用于收集本棵子树所有 DOM 构造语句的数组。
 * @returns 代表当前已创建 DOM 元素的局部变量标识符。
 */
function emitElement(
  element: t.JSXElement,
  context: EmitContext,
  statements: t.Statement[],
): t.Identifier {
  const opening = element.openingElement;
  if (!t.isJSXIdentifier(opening.name)) {
    throw new Error("Unsupported JSX element tag");
  }

  const elId = context.scope.generateUidIdentifier("el");
  const createElCall = t.callExpression(
    t.memberExpression(t.identifier("document"), t.identifier("createElement")),
    [t.stringLiteral(opening.name.name)],
  );
  createElCall.loc = opening.loc ?? null;

  statements.push(t.variableDeclaration("const", [t.variableDeclarator(elId, createElCall)]));

  for (const child of element.children) {
    if (t.isJSXText(child)) {
      const text = normalizeJSXText(child.value);
      if (text.length === 0) continue;
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.cloneNode(elId, true), t.identifier("appendChild")),
            [
              t.callExpression(
                t.memberExpression(t.identifier("document"), t.identifier("createTextNode")),
                [t.stringLiteral(text)],
              ),
            ],
          ),
        ),
      );
      continue;
    }

    if (t.isJSXExpressionContainer(child)) {
      if (t.isJSXEmptyExpression(child.expression)) continue;
      if (t.isStringLiteral(child.expression)) {
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.cloneNode(elId, true), t.identifier("appendChild")),
              [
                t.callExpression(
                  t.memberExpression(t.identifier("document"), t.identifier("createTextNode")),
                  [t.stringLiteral(child.expression.value)],
                ),
              ],
            ),
          ),
        );
        continue;
      }

      // 函数字面量子节点直接编为 _createReactiveText(expr)，其他动态表达式交给 _appendChildren(_el, expr) 保持运行时语义等价。
      // TODO: 编译函数字面量表达式与通用动态表达式子节点
      continue;
    }

    if (t.isJSXElement(child)) {
      // 可编译的子原生标签继续展平进当前语句列表；组件或暂不支持的原生标签交给 _appendChildren(_el, child)，留给外层 traverse 继续深入其内部。
      // TODO: 分流处理不可直接编译的子 JSXElement
      const childId = emitElement(child, context, statements);
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.cloneNode(elId, true), t.identifier("appendChild")),
            [t.cloneNode(childId, true)],
          ),
        ),
      );
    }
  }

  return elId;
}

/**
 * 将 TSX 源码中可编译的原生 JSX 子树直接编译为原生 DOM 操作，并按需在模块顶部注入无命名冲突的辅助函数导入；若未发生改写返回 null。
 *
 * @param source 原始 TypeScript / TSX 源码字符串。
 * @param options 可选文件名与运行时模块路径配置。
 * @returns 编译后的代码与 source map；未改动时返回 null。
 */
export function transformJSX(source: string, options?: TransformOptions): TransformResult | null {
  // 1. 使用 @babel/parser 开启 jsx 与 typescript 插件把源码解析为 AST。
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const runtimeModule = options?.runtimeModule ?? DEFAULT_RUNTIME_MODULE;
  // 记录整份文件实际用到的运行时辅助函数及其在 Program 作用域下防冲突的局部别名。
  const helperImports = new Map<RuntimeHelper, t.Identifier>();
  let changed = false;

  // 2. 遍历 AST：编译可处理的原生 JSX，未编译的组件或子元素保留给后续遍历继续深入其后代，最后在 Program.exit 单次注入所需 import。
  traverse(ast, {
    JSXElement(path) {
      if (!canCompileElement(path.node)) return;

      const programScope = path.scope.getProgramParent();
      const context: EmitContext = {
        scope: path.scope,
        useHelper(name) {
          let localId = helperImports.get(name);
          if (!localId) {
            localId = programScope.generateUidIdentifier(name);
            helperImports.set(name, localId);
          }
          return t.cloneNode(localId, true);
        },
      };

      const statements: t.Statement[] = [];
      const rootId = emitElement(path.node, context, statements);
      statements.push(t.returnStatement(t.cloneNode(rootId, true)));

      const iife = t.callExpression(
        t.arrowFunctionExpression([], t.blockStatement(statements)),
        [],
      );
      iife.loc = path.node.loc ?? null;

      // 当编译后的原生子树直接位于外层未编译 JSX 的子节点位置时，必须用 {} 包成 JSXExpressionContainer。
      if (path.parentPath.isJSXElement() || path.parentPath.isJSXFragment()) {
        path.replaceWith(t.jsxExpressionContainer(iife));
      } else {
        path.replaceWith(iife);
      }

      changed = true;
      // 去掉 path.skip() 让 Babel 继续遍历替换后的 IIFE，从而编译挂在 _appendChildren 中的组件/未支持元素内部的子树。
      // TODO: 移除 path.skip() 以支持混合子树内的嵌套编译
      path.skip();
    },
    Program: {
      // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
      exit(programPath) {
        // 仅当实际用到了辅助函数时，按字母序合并生成一条 import { ... } from runtimeModule 插入模块顶部。
        // TODO: 在 Program.exit 按需单次注入辅助函数导入语句
      },
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
