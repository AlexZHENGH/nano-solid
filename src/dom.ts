import { createEffect, createRoot, onCleanup, type Dispose } from "./reactive.ts";

/** 带有强类型 currentTarget 的 DOM 事件对象，便于在 onInput 与 onChange 中直接读取 value 或 checked。 */
export type TargetedEvent<T extends HTMLElement> = Event & {
  currentTarget: T;
};

/** 原生 HTML 元素支持的静态/响应式属性、表单绑定、事件回调与 ref。 */
export type ElementProps<T extends HTMLElement = HTMLElement> = {
  id?: string;
  type?: string;
  class?: string | (() => string);
  "aria-label"?: string | (() => string);
  // 只允许写入该标签真实存在、类型也一致的 DOM 属性。
  placeholder?: T extends HTMLInputElement ? string : never;
  disabled?: T extends { disabled: boolean } ? boolean | (() => boolean) : never;
  value?: T extends { value: string } ? string | (() => string) : never;
  checked?: T extends HTMLInputElement ? boolean | (() => boolean) : never;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: TargetedEvent<T>) => void;
  onChange?: (event: TargetedEvent<T>) => void;
  ref?: (element: T) => void;
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
 * 创建指定标签的原生 HTML 元素，应用静态/响应式属性、表单绑定、事件监听与 ref，并挂载全部子节点；清理逻辑统一交给当前 Owner。
 *
 * @param tag HTML 标签名。
 * @param props 元素的静态/响应式属性、事件回调与 ref。
 * @param children 需要挂载到当前元素下的原生 DOM 子节点列表。
 * @returns 对应的原生 HTML 元素节点。
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps<HTMLElementTagNameMap[K]> = {},
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
  if (props["aria-label"] !== undefined) {
    bindProperty(props["aria-label"], (value) => {
      element.setAttribute("aria-label", value);
    });
  }
  if (props.placeholder !== undefined) {
    // placeholder 仅对输入框有效，静态写入原生 DOM 属性。
    if (!(element instanceof HTMLInputElement)) {
      throw new Error(`The "placeholder" prop is not supported on <${tag}>`);
    }
    element.placeholder = props.placeholder;
  }
  if (props.onClick) {
    const handleClick = props.onClick;
    element.addEventListener("click", handleClick);
    // 用 onCleanup 成对登记事件解绑，所属 Owner 释放或构造中途抛错回滚时自动移除监听。
    onCleanup(() => {
      element.removeEventListener("click", handleClick);
    });
  }
  if (props.onInput) {
    // 绑定 input 事件并在 onCleanup 中成对移除，供受控输入框实时同步用户输入。
    const handleInput = props.onInput as EventListener;
    element.addEventListener("input", handleInput);
    onCleanup(() => {
      element.removeEventListener("input", handleInput);
    });
  }
  if (props.onChange) {
    // 绑定 change 事件并在 onCleanup 中成对移除，供复选框等表单控件监听状态变更。
    const handleChange = props.onChange as EventListener;
    element.addEventListener("change", handleChange);
    onCleanup(() => {
      element.removeEventListener("change", handleChange);
    });
  }
  if (props.disabled !== undefined) {
    // 按原生属性类型检查，输入框、按钮等拥有布尔 disabled 的元素都可以绑定。
    if (!("disabled" in element) || typeof element.disabled !== "boolean") {
      throw new Error(`The "disabled" prop is not supported on <${tag}>`);
    }
    bindProperty(props.disabled, (value) => {
      element.disabled = value;
    });
  }
  if (props.checked !== undefined) {
    // 仅输入框支持 checked 属性，直接写入布尔属性 element.checked 以支持 true / false 双向切换。
    if (!(element instanceof HTMLInputElement)) {
      throw new Error(`The "checked" prop is not supported on <${tag}>`);
    }
    bindProperty(props.checked, (value) => {
      element.checked = value;
    });
  }

  // 依次把每个子 Node 挂进当前元素；所有子节点的订阅清理已由所有权树统一接管。
  for (const child of children) {
    element.appendChild(child);
  }

  if (props.value !== undefined) {
    // 选项先挂载才能设置 select.value；同值不写入能保留输入框的光标。
    if (!("value" in element) || typeof element.value !== "string") {
      throw new Error(`The "value" prop is not supported on <${tag}>`);
    }
    bindProperty(props.value, (value) => {
      if (element.value !== value) {
        element.value = value;
      }
    });
  }

  // 所有属性、事件与子节点准备就绪后再触发 ref 回调，让外部拿到完整初始化的真实元素引用。
  props.ref?.(node);

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
