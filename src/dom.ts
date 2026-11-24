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

/**
 * 把静态文本包装成统一的 Renderable，便于与响应式节点一起传入父元素。
 *
 * @param value 不会随状态变化的静态文本内容。
 * @returns 带空释放函数的 Text Renderable。
 */
export function createStaticText(value: string): Renderable<Text> {
  const node = createText(value);
  return { node, dispose: () => {} };
}

/**
 * 创建指定标签的 HTML 元素，挂载全部子 Renderable，并返回能递归释放整棵子树的 Renderable。
 *
 * @param tag HTML 标签名。
 * @param children 需要挂载到当前元素下的子节点列表。
 * @returns 包含当前元素节点与级联释放函数的 Renderable。
 */
export function createRenderableElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  children: Renderable<Node>[] = [],
): Renderable<HTMLElementTagNameMap[K]> {
  const node = createElement(tag);

  // 依次把每个子 Renderable 持有的原生 DOM 节点挂进当前元素。
  for (const child of children) {
    mount(node, child.node);
  }

  function dispose(): void {
    // 释放父节点时把清理沿着树传给所有子节点，确保深层响应式文本也会退订。
    for (const child of children) {
      child.dispose();
    }
  }

  return { node, dispose };
}

/**
 * 将一个 Renderable 挂载到指定容器，并返回幂等的卸载函数：卸载时同时释放子树订阅并移除 DOM 节点。
 *
 * @param renderable 待挂载的根 Renderable 节点。
 * @param container 挂载目标容器节点。
 * @returns 调用后释放全部订阅并把根节点从容器移除的卸载函数。
 */
export function render(renderable: Renderable<Node>, container: Node): Dispose {
  mount(container, renderable.node);

  let disposed = false;

  return () => {
    // 卸载函数必须幂等，先释放整棵树的响应式订阅与事件监听，再只把本次挂载的根节点从父节点移除。
    if (disposed) return;
    disposed = true;

    renderable.dispose();
    renderable.node.parentNode?.removeChild(renderable.node);
  };
}
