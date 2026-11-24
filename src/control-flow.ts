import { createEffect, createRoot, onCleanup, type Dispose } from "./reactive.ts";

/** 条件渲染组件 <Show> 的输入属性：使用函数 getter 和懒分支工厂避免无编译器时的提前求值。 */
export type ShowProps<T> = {
  /** 读取当前条件的响应式 getter；按真假决定挂载 children 还是 fallback。 */
  when: () => T;
  /** 条件为假时延迟创建占位节点的工厂函数。 */
  fallback?: () => Node;
  /** 条件为真时延迟创建主分支节点的工厂函数。 */
  children: () => Node;
};

/**
 * 条件渲染组件：用一对 Comment 锚点维护动态区间，在条件真假切换时释放旧分支作用域并在独立 createRoot 内创建新分支。
 *
 * @param props 条件 getter、主分支工厂与可选 fallback 工厂。
 * @returns 包含起止注释锚点与初始分支节点的 DocumentFragment。
 */
export function Show<T>(props: ShowProps<T>): Node {
  const fragment = document.createDocumentFragment();
  const start = document.createComment("show-start");
  const end = document.createComment("show-end");
  fragment.appendChild(start);
  fragment.appendChild(end);

  let hasRendered = false;
  let lastCondition = false;
  let disposeBranch: Dispose | undefined;

  /** 清空 start 与 end 两枚锚点之间的全部 DOM 节点，保留锚点本身与外部兄弟节点。 */
  function clearRange(): void {
    let cursor = start.nextSibling;
    while (cursor && cursor !== end) {
      const next = cursor.nextSibling;
      cursor.parentNode?.removeChild(cursor);
      cursor = next;
    }
  }

  /** 释放当前分支的独立根作用域，并在 finally 中清空锚点区间内的全部节点。 */
  function clearBranch(): void {
    const currentDispose = disposeBranch;
    disposeBranch = undefined;
    try {
      currentDispose?.();
    } finally {
      clearRange();
    }
  }

  // 在 <Show> 自身所属的稳定 Owner 上登记清理，确保外层卸载时同步释放当前分支并清空锚点区间。
  onCleanup(() => {
    clearBranch();
  });

  // 仅追踪 props.when()：条件真假不变时保留现有分支；切换时先 clearBranch()，再在独立 createRoot 内创建新分支并插入到 end 锚点前。
  createEffect(() => {
    const nextCondition = Boolean(props.when());
    // 真假结果未发生变化时直接跳过，避免无意义销毁并重建现有 DOM 实例。
    if (hasRendered && nextCondition === lastCondition) {
      return;
    }

    hasRendered = true;
    lastCondition = nextCondition;

    // 切换分支前先释放旧分支的独立根作用域并清空锚点区间，再按新条件选择对应工厂。
    clearBranch();
    const factory = nextCondition ? props.children : props.fallback;
    if (!factory) {
      return;
    }

    // 首次执行时 end.parentNode 是临时 fragment，挂载后则是真实父容器，始终指向当前插入目标。
    const parent = end.parentNode;
    if (!parent) {
      return;
    }

    // 在独立 createRoot 内求值工厂以隔离外层依赖追踪，确认成功后才记录 disposeBranch 并插入到 end 锚点之前。
    let nextDispose: Dispose | undefined;
    const branchNode = createRoot((dispose) => {
      nextDispose = dispose;
      return factory();
    });
    disposeBranch = nextDispose;
    parent.insertBefore(branchNode, end);
  });

  return fragment;
}
