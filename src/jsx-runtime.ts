import {
  createReactiveText,
  createRenderableElement,
  createStaticText,
  type ElementProps,
  type Renderable,
} from "./dom.ts";

/** 允许作为原生 JSX 标签的 HTML 元素名。 */
type Tag = keyof HTMLElementTagNameMap;

/** JSX 子节点允许的值：静态文本、数字、可忽略的布尔/空值、已有 Renderable、响应式函数以及任意嵌套数组。 */
export type JSXChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | Renderable
  | (() => string | number)
  | JSXChild[];

/** 原生 HTML 标签接收的 JSX 属性：元素属性与可选 children。 */
export type Props = {
  children?: JSXChild;
} & ElementProps;

/** 函数组件类型：接收属性对象，在创建时执行一次并返回真实 DOM 的 Renderable。 */
export type Component<P = Record<string, never>> = (props: P) => Renderable;

/**
 * 运行时类型守卫：判断任意子节点值是否已经是 Renderable 对象。
 *
 * @param value 待判断的子节点值。
 * @returns 若为包含 DOM Node 与 dispose 函数的 Renderable 则返回 true。
 */
function isRenderable(value: unknown): value is Renderable {
  return (
    typeof value === "object" &&
    value !== null &&
    "node" in value &&
    value.node instanceof Node &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

/**
 * 将 JSX 传入的任意子节点归一化为扁平的 Renderable 列表。
 *
 * @param children JSX props.children，可能是单个值、嵌套数组、响应式函数或空值。
 * @returns 可直接交给 createRenderableElement 挂载与释放的 Renderable 数组。
 */
function normalizeChildren(children: JSXChild): Renderable[] {
  if (children === undefined || children === null || typeof children === "boolean") {
    return [];
  }

  if (typeof children === "string") {
    return [createStaticText(children)];
  }

  // 把嵌套数组、数字（含 0）、响应式函数子节点和已有 Renderable 统一转换为 Renderable 列表。
  if (Array.isArray(children)) {
    return children.flatMap(normalizeChildren);
  }

  if (typeof children === "number") {
    return [createStaticText(String(children))];
  }

  if (typeof children === "function") {
    return [createReactiveText(() => String(children()))];
  }

  if (isRenderable(children)) {
    return [children];
  }

  throw new Error(`Unsupported JSX child: ${String(children)}`);
}

/**
 * 自动 JSX 运行时入口：将原生 HTML 标签或函数组件表达式转为真实 DOM 的 Renderable。
 *
 * @param tag HTML 标签名或函数组件。
 * @param props 元素属性对象（包含可选 children）或组件属性对象。
 * @returns 对应的元素或组件 Renderable。
 */
export function jsx<K extends Tag>(tag: K, props: Props): Renderable<HTMLElementTagNameMap[K]>;
export function jsx<P>(tag: Component<P>, props: P): Renderable;
export function jsx<P>(tag: Tag | Component<P>, props: Props | P): Renderable {
  // 若 tag 是函数组件，直接调用一次 tag(props) 返回它构造的 Renderable；后续细粒度更新由内部表达式自行承担。
  if (typeof tag === "function") {
    return tag(props as P);
  }

  const elementProps = props as Props;
  return createRenderableElement(tag, elementProps, normalizeChildren(elementProps.children));
}

/** 多子节点 JSX 表达式与单子节点共享同一套归一化逻辑。 */
export const jsxs = jsx;

/** Vite 开发模式下自动 JSX 转换调用的入口函数。 */
export const jsxDEV = jsx;

/** TypeScript 自动 JSX 转换读取的类型命名空间。 */
export namespace JSX {
  /** 每个 JSX 表达式直接求值为真实 DOM 的 Renderable，而非虚拟 DOM 对象。 */
  export type Element = Renderable;

  /** 所有原生 HTML 标签共享的基础 JSX 属性定义。 */
  export type IntrinsicElements = {
    [K in Tag]: Props;
  };
}
