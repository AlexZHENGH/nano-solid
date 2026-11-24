import { createEffect, type Dispose } from "./reactive.ts";

/** 可挂载到 DOM 且自带清理逻辑的渲染单元。 */
export type Renderable<T extends Node> = {
  node: T;
  dispose: Dispose;
};

/**
 * 创建指定标签名的 HTML 元素，并保留对应的 DOM 元素类型。
 *
 * @param tag HTML 标签名。
 * @returns 对应的 HTML 元素节点。
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

/**
 * 创建一个原生文本节点。
 *
 * @param value 初始文本内容。
 * @returns 新建的 Text 节点。
 */
export function createText(value: string): Text {
  return document.createTextNode(value);
}

/**
 * 将子节点追加挂载到父节点末尾。
 *
 * @param parent 父容器节点。
 * @param child 待挂载的子节点。
 */
export function mount(parent: Node, child: Node): void {
  parent.appendChild(child);
}

/**
 * 创建一个会随内部读取的 signal 自动原地更新的文本节点，并返回对应的释放函数。
 *
 * @param getValue 读取响应式状态并返回当前文本内容的 getter。
 * @returns 包含同一个 Text 节点引用与释放函数的 Renderable。
 */
export function createReactiveText(getValue: () => string): Renderable<Text> {
  const node = createText("");

  // 用 createEffect 追踪 getValue() 中读取的 signal，变化时原地更新同一个 Text 节点的 .data。
  const dispose = createEffect(() => {
    node.data = getValue();
  });

  return { node, dispose };
}
