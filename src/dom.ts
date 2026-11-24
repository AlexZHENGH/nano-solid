import { createEffect, createRoot, onCleanup, type Dispose } from "./reactive.ts";

/** 原生 HTML 元素支持的静态/响应式属性与点击事件。 */
export type ElementProps = {
  id?: string;
  type?: string;
  class?: string | (() => string);
  disabled?: boolean | (() => boolean);
  onClick?: (event: MouseEvent) => void;
};

/**
 * 创建一个原生静态文本节点。
 *
 * @param value 文本内容。
 * @returns 新建的原生 Text 节点。
 */
export function createText(value: string): Text {
  return document.createTextNode(value);
}

/**
 * 创建一个会随内部读取的 signal 自动原地更新的原生文本节点，其订阅自动归属当前活跃的 Owner。
 *
 * @param getValue 读取响应式状态并返回当前文本内容的 getter。
 * @returns 会在状态变化时原地更新 .data 的原生 Text 节点。
 */
export function createReactiveText(getValue: () => string): Text {
  const node = createText("");

  // createEffect 自动挂入当前 Owner，作用域释放时随所有权树一起退订。
  createEffect(() => {
    node.data = getValue();
  });

  return node;
}

/**
 * 统一绑定静态或响应式属性：静态值立即写入，函数 getter 交给 createEffect 追踪并自动归属当前 Owner。
 *
 * @param value 静态属性值或读取响应式状态的 getter。
 * @param apply 将最新值写入真实 DOM 属性的函数。
 */
function bindProperty<T>(value: T | (() => T), apply: (next: T) => void): void {
  // 函数形态交给 createEffect 追踪并由当前 Owner 管理释放；静态值直接写入一次即可。
  if (typeof value === "function") {
    const getter = value as () => T;
    createEffect(() => apply(getter()));
    return;
  }

  apply(value);
}

/**
 * 创建指定标签的原生 HTML 元素，应用静态/响应式属性与事件监听并挂载全部子节点；清理逻辑统一交给当前 Owner。
 *
 * @param tag HTML 标签名。
 * @param props 元素的静态/响应式属性与事件回调。
 * @param children 需要挂载到当前元素下的原生 DOM 子节点列表。
 * @returns 对应的原生 HTML 元素节点。
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  // 宽化为 HTMLElement，使 addEventListener("click", ...) 命中 MouseEvent 重载。
  const element: HTMLElement = node;

  if (props.id !== undefined) {
    element.id = props.id;
  }
  if (props.type !== undefined) {
    element.setAttribute("type", props.type);
  }
  if (props.class !== undefined) {
    bindProperty(props.class, (value) => {
      element.className = value;
    });
  }
  if (props.onClick) {
    const handleClick = props.onClick;
    element.addEventListener("click", handleClick);
    // 用 onCleanup 成对登记事件解绑，所属 Owner 释放或构造中途抛错回滚时自动移除监听。
    onCleanup(() => {
      element.removeEventListener("click", handleClick);
    });
  }
  if (props.disabled !== undefined) {
    // 仅按钮元素支持 disabled 属性，对非按钮标签提前显式报错，按钮则通过 bindProperty 写入 element.disabled。
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`The "disabled" prop is not supported on <${tag}>`);
    }
    bindProperty(props.disabled, (value) => {
      element.disabled = value;
    });
  }

  // 依次把每个子 Node 挂进当前元素；所有子节点的订阅清理已由所有权树统一接管。
  for (const child of children) {
    element.appendChild(child);
  }

  return node;
}

/**
 * 在独立的 createRoot 中延迟求值视图并挂载到目标容器，返回幂等的卸载函数：卸载时释放整棵所有权树并安全移除本次挂载的节点。
 *
 * @param view 延迟创建根节点的工厂函数，确保整棵子树的副作用与清理回调都登记在本次根作用域内。
 * @param container 挂载目标容器节点。
 * @returns 调用后释放全部订阅、清理回调并移除挂载节点的幂等卸载函数。
 */
export function render(view: () => Node, container: Node): Dispose {
  return createRoot((dispose) => {
    const node = view();
    // DocumentFragment 插入后会被清空，必须在 appendChild 前先快照本次要挂载的全部顶层节点。
    const mountedNodes = node instanceof DocumentFragment ? Array.from(node.childNodes) : [node];
    container.appendChild(node);

    let disposed = false;

    return () => {
      // 卸载保持幂等：先释放所有权树，并在 finally 中只移除仍直接挂在目标容器下的节点。
      if (disposed) return;
      disposed = true;

      try {
        dispose();
      } finally {
        for (const mounted of mountedNodes) {
          if (mounted.parentNode === container) {
            container.removeChild(mounted);
          }
        }
      }
    };
  });
}
