import generate from "@babel/generator";
import { parse } from "@babel/parser";
import traverse, { type Scope } from "@babel/traverse";
import * as t from "@babel/types";

/** 仓内开发阶段编译器默认注入的运行时辅助模块路径。 */
const DEFAULT_RUNTIME_MODULE = "#nano-solid/compiler-runtime";

/** 编译器当前按需导入的运行时辅助函数名集合。 */
type RuntimeHelper = "createReactiveText" | "appendChildren" | "bindProperty" | "onCleanup";

/** 原生元素编译器支持的 JSX 事件属性到 DOM 原生事件名的映射。 */
const EVENT_NAME_MAP: Record<string, string> = {
  onClick: "click",
  onInput: "input",
  onChange: "change",
};

/** 原生元素编译器支持的全部已知属性白名单；遇到 spread 或未列出的属性时安全回退给 jsx-runtime。 */
const SUPPORTED_ATTRS = new Set([
  "id",
  "type",
  "class",
  "aria-label",
  "placeholder",
  "disabled",
  "value",
  "checked",
  "onClick",
  "onInput",
  "onChange",
  "ref",
]);

/** 允许使用 JSX 布尔简写（如 <button disabled />）的属性集合。 */
const BOOLEAN_SHORTHAND_ATTRS = new Set(["disabled", "checked"]);

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
function isReactiveTextGetter(expr: t.Expression): boolean {
  // 仅匹配无参、非 async、非 generator 的箭头函数或函数表达式，不改变 {count()} 等普通表达式的单次求值语义。
  return (
    (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) &&
    !expr.async &&
    !expr.generator &&
    expr.params.length === 0
  );
}

/**
 * 若 JSX 属性值是编译期确定的字符串字面量（如 class="ns-btn" 或 class={"ns-btn"}），解包返回该字符串；否则返回 null。
 *
 * @param value JSXAttribute 的 value 字段。
 * @returns 静态字符串内容或 null。
 */
function unwrapStaticString(value: t.JSXAttribute["value"]): string | null {
  if (t.isStringLiteral(value)) return value.value;
  if (t.isJSXExpressionContainer(value) && t.isStringLiteral(value.expression)) {
    return value.expression.value;
  }
  return null;
}

/**
 * 若 JSX 属性值是编译期确定的布尔字面量（如 <button disabled /> 或 disabled={false}），解包返回该布尔值；否则返回 null。
 *
 * @param value JSXAttribute 的 value 字段。
 * @returns 静态布尔值或 null。
 */
function unwrapStaticBoolean(value: t.JSXAttribute["value"]): boolean | null {
  if (value === null || value === undefined) return true;
  if (t.isJSXExpressionContainer(value) && t.isBooleanLiteral(value.expression)) {
    return value.expression.value;
  }
  return null;
}

/**
 * 将 JSXAttribute 的值统一提取为 JavaScript 表达式节点，供 _bindProperty、事件绑定或 ref 求值使用。
 *
 * @param value JSXAttribute 的 value 字段。
 * @returns 对应的 JS 表达式节点。
 */
function attributeValueToExpression(value: t.JSXAttribute["value"]): t.Expression {
  if (value === null || value === undefined) {
    return t.booleanLiteral(true);
  }
  if (t.isStringLiteral(value)) {
    return t.stringLiteral(value.value);
  }
  if (t.isJSXExpressionContainer(value) && t.isExpression(value.expression)) {
    return value.expression;
  }
  throw new Error("Unsupported JSX attribute value");
}

/**
 * 判断一个 JSXElement 当前是否可以安全编译为直接 DOM 调用：
 * 支持带已知静态/响应式属性、事件与 ref 的小写原生标签（不含 spread、未知属性或重复属性），以及任意文本/表达式/子元素。
 *
 * @param element 待检查的 JSXElement AST 节点。
 * @returns 是否支持把该原生元素编译为直接 DOM 调用。
 */
function canCompileElement(element: t.JSXElement): boolean {
  const opening = element.openingElement;
  if (!t.isJSXIdentifier(opening.name)) return false;
  if (!/^[a-z]/.test(opening.name.name)) return false;

  // 校验属性列表：只接受 SUPPORTED_ATTRS 中的非重复普通 JSXAttribute（排除 spread、未知属性、非法布尔简写与空表达式）。
  const seenAttrs = new Set<string>();
  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) return false;
    const name = attr.name.name;
    if (!SUPPORTED_ATTRS.has(name)) return false;
    if (seenAttrs.has(name)) return false;
    seenAttrs.add(name);

    if (attr.value === null || attr.value === undefined) {
      if (!BOOLEAN_SHORTHAND_ATTRS.has(name)) return false;
    } else if (t.isJSXExpressionContainer(attr.value)) {
      if (t.isJSXEmptyExpression(attr.value.expression)) return false;
    } else if (!t.isStringLiteral(attr.value)) {
      return false;
    }
  }

  // 允许 JSXText、JSXExpressionContainer 以及任意 JSXElement 子节点（排除 JSXFragment 与 JSXSpreadChild）。
  return element.children.every(
    (child) => t.isJSXText(child) || t.isJSXElement(child) || t.isJSXExpressionContainer(child),
  );
}

/**
 * 按源码顺序把元素上的全部受支持属性与事件编译为直接 DOM 语句或辅助调用，并记录延迟到子节点挂载后再触发的 ref 变量名。
 *
 * @param tagName 原生 HTML 标签名（用于静态校验 input/button 专属属性）。
 * @param attributes JSX 开始标签上的属性列表。
 * @param elId 当前元素的局部变量标识符。
 * @param context 包含作用域与按需导入登记器的编译上下文。
 * @param statements 用于收集属性与事件绑定语句的数组。
 * @param afterChildren 存放必须等子节点挂载后执行的属性绑定。
 * @returns 若存在 ref 属性则返回已求值的临时变量标识符，否则返回 null。
 */
function emitAttributes(
  tagName: string,
  attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
  elId: t.Identifier,
  context: EmitContext,
  statements: t.Statement[],
  afterChildren: t.Statement[],
): t.Identifier | null {
  // 静态属性直出 DOM 赋值/setAttribute；动态或需标签校验属性走 _bindProperty；事件先存临时变量 _h 再 addEventListener + _onCleanup；ref 先求值存 _ref 并延后调用。
  let refId: t.Identifier | null = null;

  for (const attr of attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
    const name = attr.name.name;

    if (name === "ref") {
      refId = context.scope.generateUidIdentifier("ref");
      statements.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(refId, attributeValueToExpression(attr.value)),
        ]),
      );
      continue;
    }

    const eventName = EVENT_NAME_MAP[name];
    if (eventName) {
      const handlerId = context.scope.generateUidIdentifier("h");
      const onCleanupId = context.useHelper("onCleanup");
      statements.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(handlerId, attributeValueToExpression(attr.value)),
        ]),
      );
      statements.push(
        t.ifStatement(
          t.cloneNode(handlerId, true),
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.cloneNode(elId, true), t.identifier("addEventListener")),
                [t.stringLiteral(eventName), t.cloneNode(handlerId, true)],
              ),
            ),
            t.expressionStatement(
              t.callExpression(onCleanupId, [
                t.arrowFunctionExpression(
                  [],
                  t.callExpression(
                    t.memberExpression(
                      t.cloneNode(elId, true),
                      t.identifier("removeEventListener"),
                    ),
                    [t.stringLiteral(eventName), t.cloneNode(handlerId, true)],
                  ),
                ),
              ]),
            ),
          ]),
        ),
      );
      continue;
    }

    const staticString = unwrapStaticString(attr.value);
    const staticBoolean = unwrapStaticBoolean(attr.value);

    if (name === "id" && staticString !== null) {
      statements.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(t.cloneNode(elId, true), t.identifier("id")),
            t.stringLiteral(staticString),
          ),
        ),
      );
      continue;
    }

    if (name === "type" && staticString !== null) {
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.cloneNode(elId, true), t.identifier("setAttribute")),
            [t.stringLiteral("type"), t.stringLiteral(staticString)],
          ),
        ),
      );
      continue;
    }

    if (name === "class" && staticString !== null) {
      statements.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(t.cloneNode(elId, true), t.identifier("className")),
            t.stringLiteral(staticString),
          ),
        ),
      );
      continue;
    }

    if (name === "aria-label" && staticString !== null) {
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.cloneNode(elId, true), t.identifier("setAttribute")),
            [t.stringLiteral("aria-label"), t.stringLiteral(staticString)],
          ),
        ),
      );
      continue;
    }

    if (name === "placeholder" && tagName === "input" && staticString !== null) {
      statements.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(t.cloneNode(elId, true), t.identifier("placeholder")),
            t.stringLiteral(staticString),
          ),
        ),
      );
      continue;
    }

    if (name === "value" && tagName === "input" && staticString !== null) {
      statements.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(t.cloneNode(elId, true), t.identifier("value")),
            t.stringLiteral(staticString),
          ),
        ),
      );
      continue;
    }

    if (name === "disabled" && tagName === "button" && staticBoolean !== null) {
      statements.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(t.cloneNode(elId, true), t.identifier("disabled")),
            t.booleanLiteral(staticBoolean),
          ),
        ),
      );
      continue;
    }

    if (name === "checked" && tagName === "input" && staticBoolean !== null) {
      statements.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.memberExpression(t.cloneNode(elId, true), t.identifier("checked")),
            t.booleanLiteral(staticBoolean),
          ),
        ),
      );
      continue;
    }

    const bindPropertyId = context.useHelper("bindProperty");
    if (name === "value" && tagName === "select") {
      // 属性表达式照源码顺序求值，绑定要等 option 已挂载才能选中指定值。
      const valueId = context.scope.generateUidIdentifier("value");
      statements.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(valueId, attributeValueToExpression(attr.value)),
        ]),
      );
      afterChildren.push(
        t.expressionStatement(
          t.callExpression(bindPropertyId, [
            t.cloneNode(elId, true),
            t.stringLiteral(name),
            t.cloneNode(valueId, true),
          ]),
        ),
      );
      continue;
    }
    statements.push(
      t.expressionStatement(
        t.callExpression(bindPropertyId, [
          t.cloneNode(elId, true),
          t.stringLiteral(name),
          attributeValueToExpression(attr.value),
        ]),
      ),
    );
  }

  return refId;
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

  const tagName = opening.name.name;
  const elId = context.scope.generateUidIdentifier("el");
  const createElCall = t.callExpression(
    t.memberExpression(t.identifier("document"), t.identifier("createElement")),
    [t.stringLiteral(tagName)],
  );
  createElCall.loc = opening.loc ?? null;

  statements.push(t.variableDeclaration("const", [t.variableDeclarator(elId, createElCall)]));

  // 1. 先按源码顺序编译属性、事件并暂存 ref 表达式。
  const afterChildren: t.Statement[] = [];
  const refId = emitAttributes(
    tagName,
    opening.attributes,
    elId,
    context,
    statements,
    afterChildren,
  );

  // 2. 再依次挂载文本、响应式函数、动态表达式与子元素。
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
      if (isReactiveTextGetter(child.expression)) {
        const reactiveTextId = context.useHelper("createReactiveText");
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.cloneNode(elId, true), t.identifier("appendChild")),
              [t.callExpression(reactiveTextId, [child.expression])],
            ),
          ),
        );
      } else {
        const appendChildrenId = context.useHelper("appendChildren");
        statements.push(
          t.expressionStatement(
            t.callExpression(appendChildrenId, [t.cloneNode(elId, true), child.expression]),
          ),
        );
      }
      continue;
    }

    if (t.isJSXElement(child)) {
      // 可编译的子原生标签继续展平进当前语句列表；组件或暂不支持的原生标签交给 _appendChildren(_el, child)，留给外层 traverse 继续深入其内部。
      if (canCompileElement(child)) {
        const childId = emitElement(child, context, statements);
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.cloneNode(elId, true), t.identifier("appendChild")),
              [t.cloneNode(childId, true)],
            ),
          ),
        );
      } else {
        const appendChildrenId = context.useHelper("appendChildren");
        statements.push(
          t.expressionStatement(
            t.callExpression(appendChildrenId, [t.cloneNode(elId, true), child]),
          ),
        );
      }
    }
  }

  // 3. 所有属性、事件与子节点准备就绪后再调用 ref 回调，与 dom.ts 的 createElement 时机保持一致。
  statements.push(...afterChildren);

  if (refId) {
    statements.push(
      t.ifStatement(
        t.cloneNode(refId, true),
        t.expressionStatement(
          t.callExpression(t.cloneNode(refId, true), [t.cloneNode(elId, true)]),
        ),
      ),
    );
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
    },
    Program: {
      exit(programPath) {
        // 仅当实际用到了辅助函数时，按字母序合并生成一条 import { ... } from runtimeModule 插入模块顶部。
        if (helperImports.size === 0) return;

        const specifiers = Array.from(helperImports.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([importedName, localId]) =>
            t.importSpecifier(t.cloneNode(localId, true), t.identifier(importedName)),
          );
        const importDecl = t.importDeclaration(specifiers, t.stringLiteral(runtimeModule));
        programPath.unshiftContainer("body", importDecl);
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
