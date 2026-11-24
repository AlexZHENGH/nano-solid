import {
  createEffect,
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  createRoot,
  onCleanup,
  type Dispose,
} from "./reactive.ts";

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

  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  let hasRendered = false;
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
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
    // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
    const nextCondition = Boolean(props.when());
    // TODO: 若 hasRendered && nextCondition === lastCondition 直接返回；否则更新标记并调用 clearBranch()，选出 children 或 fallback 工厂，在 createRoot 中构造节点并插入到 end 锚点之前。
  });

  return fragment;
}
