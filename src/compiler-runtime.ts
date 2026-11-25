import { createReactiveText as createDomReactiveText } from "./dom.ts";
import { normalizeChildren, type JSXChild } from "./jsx-runtime.ts";

/**
 * 供编译器产出的响应式文本辅助函数：兼容 string 与 number 返回值，与 jsx-runtime 的 normalizeChildren 保持一致。
 *
 * @param getValue 读取响应式状态并返回文本或数字的 getter。
 * @returns 会在状态变化时原地更新 .data 并归属当前 Owner 的原生 Text 节点。
 */
export function createReactiveText(getValue: () => string | number): Text {
  // 委托给 dom.ts 的 createReactiveText，并统一通过 String() 转换数字与字符串返回值。
  return createDomReactiveText(() => String(getValue()));
}

/**
 * 供编译器产出的动态子节点挂载辅助函数：复用 normalizeChildren 处理任意运行时值（数字 0、布尔/空值、数组、Node、DocumentFragment 或函数变量）。
 *
 * @param parent 目标父 DOM 节点。
 * @param child 任意合法的 JSXChild 运行时值。
 */
export function appendChildren(parent: Node, child: JSXChild): void {
  // 复用 jsx-runtime 导出的 normalizeChildren 逐个挂载，保证与运行时路径 100% 等价。
  for (const node of normalizeChildren(child)) {
    parent.appendChild(node);
  }
}
