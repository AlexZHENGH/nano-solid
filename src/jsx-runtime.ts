import { createElement, createReactiveText, createText, type ElementProps } from "./dom.ts";

/** 允许作为原生 JSX 标签的 HTML 元素名。 */
type Tag = keyof HTMLElementTagNameMap;

/** JSX 子节点允许的值：静态文本、数字、可忽略的布尔/空值、原生 DOM Node、响应式函数以及任意嵌套数组。 */
export type JSXChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | Node
  | (() => string | number)
  | JSXChild[];

/** 原生 HTML 标签接收的 JSX 属性：按具体标签保留强类型事件与 ref，并附带可选 children。 */
export type Props<K extends Tag = Tag> = {
  children?: JSXChild;
} & ElementProps<HTMLElementTagNameMap[K]>;

/** 函数组件类型：接收属性对象，在创建时执行一次并返回原生 DOM Node。 */
export type Component<P = Record<string, never>> = (props: P) => Node;

/**
 * 将 JSX 传入的任意子节点归一化为扁平的原生 DOM Node 列表。
 *
 * @param children JSX props.children，可能是单个值、嵌套数组、响应式函数或空值。
 * @returns 可直接交给 createElement 挂载的 Node 数组。
 */
export function normalizeChildren(children: JSXChild): Node[] {
  if (children === undefined || children === null || typeof children === "boolean") {
    return [];
  }

  if (typeof children === "string") {
    return [createText(children)];
  }

  // 把嵌套数组、数字（含 0）、响应式函数子节点和原生 Node 统一转换为 Node 列表。
  if (Array.isArray(children)) {
    return children.flatMap(normalizeChildren);
  }

  if (typeof children === "number") {
    return [createText(String(children))];
  }

  if (typeof children === "function") {
    return [createReactiveText(() => String(children()))];
  }

  if (children instanceof Node) {
    return [children];
  }

  throw new Error(`Unsupported JSX child: ${String(children)}`);
}

/**
 * 自动 JSX 运行时入口：将原生 HTML 标签或函数组件表达式转为原生 DOM Node。
 *
 * @param tag HTML 标签名或函数组件。
 * @param props 元素属性对象（包含可选 children）或组件属性对象。
 * @returns 对应的原生 DOM 节点。
 */
export function jsx<K extends Tag>(tag: K, props: Props<K>): HTMLElementTagNameMap[K];
export function jsx<P>(tag: Component<P>, props: P): Node;
export function jsx<P>(tag: Tag | Component<P>, props: Props | P): Node {
  // 若 tag 是函数组件，直接调用一次 tag(props) 返回它构造的 Node；后续细粒度更新由内部表达式自行承担。
  if (typeof tag === "function") {
    return tag(props as P);
  }

  const elementProps = props as ElementProps<HTMLElementTagNameMap[typeof tag]> & {
    children?: JSXChild;
  };
  return createElement(tag, elementProps, normalizeChildren(elementProps.children));
}

/** 多子节点 JSX 表达式与单子节点共享同一套归一化逻辑。 */
export const jsxs = jsx;

/** Vite 开发模式下自动 JSX 转换调用的入口函数。 */
export const jsxDEV = jsx;

/** TypeScript 自动 JSX 转换读取的类型命名空间。 */
export namespace JSX {
  /** 每个 JSX 表达式直接求值为原生 DOM Node，生命周期清理统一交给所有权树。 */
  export type Element = Node;

  /** 按标签名映射各自的强类型 JSX 属性定义（使 <input> 的 ref 与 onInput 自动推导为 HTMLInputElement）。 */
  export type IntrinsicElements = {
    [K in Tag]: Props<K>;
  };
}
