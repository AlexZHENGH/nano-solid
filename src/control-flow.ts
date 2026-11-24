import { createEffect, createRoot, createSignal, onCleanup, type Dispose } from "./reactive.ts";

/**
 * 清空起止两枚 Comment 锚点之间的全部 DOM 节点，保留两枚锚点本身与外部兄弟节点。
 *
 * @param start 区间起始注释锚点。
 * @param end 区间结束注释锚点。
 */
function clearBetween(start: Comment, end: Comment): void {
  let cursor = start.nextSibling;
  while (cursor && cursor !== end) {
    const next = cursor.nextSibling;
    cursor.parentNode?.removeChild(cursor);
    cursor = next;
  }
}

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

  /** 释放当前分支的独立根作用域，并在 finally 中清空锚点区间内的全部节点。 */
  function clearBranch(): void {
    const currentDispose = disposeBranch;
    disposeBranch = undefined;
    try {
      currentDispose?.();
    } finally {
      clearBetween(start, end);
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

/** 列表渲染组件 <For> 的输入属性：支持可选 getKey，并以响应式 item() 与 index() 复用行节点。 */
export type ForProps<T, K = T> = {
  /** 读取当前列表数组的响应式 getter。 */
  each: () => readonly T[];
  /** 可选的稳定键提取函数；省略时默认以数组元素本身作为复用标识。 */
  getKey?: (item: T) => K;
  /** 列表为空时延迟创建占位节点的工厂函数。 */
  fallback?: () => Node;
  /** 渲染单行节点的工厂函数：接收当前项与下标的响应式 getter，仅在行首次创建时执行一次。 */
  children: (item: () => T, index: () => number) => Node;
};

/** 单行列表项的内部记录：自带起止 Comment 锚点、独立根释放函数，以及更新项数据与下标的 setter。 */
type RowEntry<T> = {
  key: unknown;
  start: Comment;
  end: Comment;
  /** 首次创建后尚未插入真实 DOM 时暂存该行的 DocumentFragment，首次挂载后置为 undefined。 */
  initialFragment: DocumentFragment | undefined;
  dispose: Dispose;
  setItem: (next: T) => void;
  setIndex: (next: number) => void;
};

/**
 * 列表渲染组件：按 key（默认按元素本身）复用已有行节点与独立作用域，只释放被移除的行并从右往左原地重排 DOM。
 *
 * @param props 列表 getter、可选 getKey、可选 fallback 与单行渲染工厂。
 * @returns 包含起止注释锚点与初始列表内容的 DocumentFragment。
 */
export function For<T, K = T>(props: ForProps<T, K>): Node {
  const fragment = document.createDocumentFragment();
  const start = document.createComment("for-start");
  const end = document.createComment("for-end");
  fragment.appendChild(start);
  fragment.appendChild(end);

  let activeRows: RowEntry<T>[] = [];
  let hasFallback = false;
  let disposeFallback: Dispose | undefined;

  /** 移除单行从 start 到 end（含两端锚点）的全部 DOM 节点。 */
  function removeRowNodes(entry: RowEntry<T>): void {
    // 若该行还停留在未挂载的临时 Fragment 中（例如工厂抛错回滚），直接丢弃即可，无需操作真实 DOM。
    if (entry.initialFragment) {
      entry.initialFragment = undefined;
      return;
    }
    // 沿链表从 start 走到 end（包含两端锚点），把行内嵌套 <Show> 动态替换出来的节点也一并删净。
    let cursor: Node | null = entry.start;
    while (cursor) {
      const next: Node | null = cursor === entry.end ? null : cursor.nextSibling;
      cursor.parentNode?.removeChild(cursor);
      cursor = next;
    }
  }

  /** 释放单行的独立 createRoot 作用域，并在 finally 中移除该行的全部 DOM 节点。 */
  function disposeRow(entry: RowEntry<T>): void {
    try {
      entry.dispose();
    } finally {
      removeRowNodes(entry);
    }
  }

  /** 在独立的 createRoot 中新建一行，并用专属起止 Comment 锚点包住该行的全部动态节点。 */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  function createRowEntry(key: unknown, initialItem: T, initialIndex: number): RowEntry<T> {
    // 每行自带一对锚点装进临时 Fragment，方便后续整体首次插入与按区间移动/删除。
    const rowStart = document.createComment("for-item-start");
    const rowEnd = document.createComment("for-item-end");
    const rowFragment = document.createDocumentFragment();
    rowFragment.appendChild(rowStart);
    rowFragment.appendChild(rowEnd);

    // 为当前行建立响应式 item 与 index 信号：后续复用本行时只需更新这两个 setter，无需重跑行组件。
    const [item, setItem] = createSignal(initialItem);
    const [index, setIndex] = createSignal(initialIndex);

    // 行工厂运行在独立的 createRoot 内：既隔绝外层 each 依赖追踪，又能按行独立释放副作用。
    let disposeHandle: Dispose | undefined;
    const node = createRoot((dispose) => {
      disposeHandle = dispose;
      return props.children(item, index);
    });
    // 把行内容插在 rowStart 与 rowEnd 之间，即使行内嵌套 <Show> 返回 DocumentFragment 也能完整包住。
    rowFragment.insertBefore(node, rowEnd);

    return {
      key,
      start: rowStart,
      end: rowEnd,
      initialFragment: rowFragment,
      dispose: disposeHandle ?? (() => {}),
      setItem,
      setIndex,
    };
  }

  /** 把单行（新建或已挂载）摆放到指定参照节点之前；若该行已处于正确位置则跳过 DOM 移动。 */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  function placeRowBefore(parent: Node, entry: RowEntry<T>, before: Node): void {
    // 首次挂载的新行：一次性把暂存 Fragment 插入到 before 之前，随后清空 initialFragment 标记已挂载。
    if (entry.initialFragment) {
      const initial = entry.initialFragment;
      entry.initialFragment = undefined;
      parent.insertBefore(initial, before);
      return;
    }
    // 该行结束锚点的下一个兄弟已经正好是目标参照节点时，说明本行无需移动，跳过以保留焦点与零 DOM 抖动。
    if (entry.end.nextSibling === before) {
      return;
    }
    // 已挂载但位置不对的复用行：从 start 到 end 顺次把整段区间搬到 before 之前。
    let cursor: Node | null = entry.start;
    while (cursor) {
      const next: Node | null = cursor === entry.end ? null : cursor.nextSibling;
      parent.insertBefore(cursor, before);
      cursor = next;
    }
  }

  /** 释放全部当前活跃行并清空列表状态。 */
  function disposeAllRows(): void {
    const rows = activeRows;
    activeRows = [];
    for (const row of rows.reverse()) {
      disposeRow(row);
    }
  }

  /** 释放空列表 fallback 作用域并清空外层起止锚点之间的节点。 */
  function clearFallback(): void {
    if (!hasFallback) return;
    hasFallback = false;
    const currentDispose = disposeFallback;
    disposeFallback = undefined;
    try {
      currentDispose?.();
    } finally {
      clearBetween(start, end);
    }
  }

  /** 在独立 createRoot 中挂载空列表 fallback 到外层 end 锚点之前。 */
  function mountFallback(parent: Node): void {
    hasFallback = true;
    if (!props.fallback) return;

    let nextDispose: Dispose | undefined;
    const node = createRoot((dispose) => {
      nextDispose = dispose;
      return props.fallback!();
    });
    disposeFallback = nextDispose;
    parent.insertBefore(node, end);
  }

  // 在 <For> 自身所属的稳定 Owner 上登记清理，外层卸载时级联释放全部活跃行与 fallback。
  onCleanup(() => {
    try {
      disposeAllRows();
    } finally {
      clearFallback();
    }
  });

  // 仅追踪 props.each()：列表为空时切到 fallback，非空时按两阶段协调（先建齐新行、再提交重排与更新）复用旧行。
  createEffect(() => {
    const nextItems = props.each();
    const parent = end.parentNode;
    if (!parent) return;

    if (nextItems.length === 0) {
      disposeAllRows();
      if (!hasFallback) {
        mountFallback(parent);
      }
      return;
    }

    // 阶段 1：把 activeRows 按 key 放进旧行队列 Map<unknown, RowEntry<T>[]>，遍历 nextItems 尝试从队头复用，未命中则调用 createRowEntry；若任意工厂抛错，逆序 disposeRow 回滚本轮新建行再重抛。
    // 阶段 2：调用 clearFallback() 并释放旧行队列里剩余未复用的行；从右往左以 end 为初始游标调用 placeRowBefore 原地重排；更新 activeRows，最后为复用行调用 setItem 和 setIndex。
    // TODO: 实现阶段 1（按 key 队列复用与抛错回滚）与阶段 2（清理未复用旧行、从右往左原地重排并更新复用行的 item / index 信号）。
  });

  return fragment;
}
