/** 会随读取过的 signal 变化而重新执行的副作用函数。 */
export type EffectCallback = () => void;

/** 用于停止一个作用域或 effect 订阅并释放依赖的清理函数。 */
export type Dispose = () => void;

/**
 * 内部维护的所有权节点：记录所属父节点、下属子作用域、清理回调列表、释放状态以及自身收尾钩子。
 */
type Owner = {
  parent: Owner | undefined;
  children: Set<Owner>;
  cleanups: Dispose[];
  disposed: boolean;
  onDispose?: () => void;
};

/**
 * 响应式数据源（signal 与 memo 的公共上游结构）：维护下游订阅者集合与单调递增的版本号。
 */
type Source = {
  subscribers: Set<Computation>;
  version: number;
};

/**
 * 计算节点的公共底座：同时是 Owner，并以 Map 记录上一轮按读取顺序访问过的上游数据源及其版本号快照。
 */
type ComputationBase = Owner & {
  dependencies: Map<Source, number>;
};

/** 内部维护的 effect 计算节点：保存用户副作用回调。 */
type Effect = ComputationBase & {
  kind: "effect";
  callback: EffectCallback;
};

/** memo 的三态标记：clean（缓存新鲜）、check（上游 memo 可能变化）、dirty（直接依赖已变化）。 */
type MemoState = "clean" | "check" | "dirty";

/**
 * 内部维护的 memo 计算节点：既是下游 Computation（追踪上游依赖），又是上游 Source（供下游订阅并维护版本号）。
 */
type Memo<T = unknown> = ComputationBase &
  Source & {
    kind: "memo";
    compute: () => T;
    value: T | undefined;
    initialized: boolean;
    state: MemoState;
  };

/** 响应式依赖图中的计算节点联合类型。 */
type Computation = Effect | Memo;

/** 记录当前同步执行中的计算节点（effect 或 memo），读值时靠它建立依赖边并记录版本快照。 */
let currentComputation: Computation | undefined;

/** 计算仍在执行时，可以暂时关闭依赖登记，写入仍按执行顺序排队。 */
let tracking = true;

/** 记录当前活跃的所有权作用域，新创建的子计算与清理回调会自动归属于它。 */
let currentOwner: Owner | undefined;

/** 当前嵌套的 batch 深度；大于 0 时把受影响的计算暂存进队列，等最外层退出再统一刷新。 */
let batchDepth = 0;

/** 标记当前是否正在执行 flushEffects，避免刷新途中触发嵌套刷新。 */
let isFlushing = false;

/** 等待本轮统一执行的去重 effect 队列。 */
const pendingEffects = new Set<Effect>();

/** 等待本轮补刷的独立急切 memo 队列。 */
const pendingMemos = new Set<Memo>();

/**
 * 判断一个上游 Source 是否为 Memo 节点（只有 Memo 需要在 Pull 阶段递归核对并刷新）。
 *
 * @param source 上游数据源节点。
 * @returns 是否为 Memo。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function isMemo(source: Source): source is Memo {
  return "kind" in source && source.kind === "memo";
}

/**
 * 在当前同步执行的计算节点与上游数据源之间登记双向依赖，并记录此刻观察到的上游版本号。
 *
 * @param source 本次被读取的 signal 或 memo 数据源。
 */
function track(source: Source): void {
  // 只有在已开启追踪且未释放的计算节点执行期间读值，才建立双向边并记下当前的 source.version 快照。
  if (!tracking || !currentComputation || currentComputation.disposed) return;
  source.subscribers.add(currentComputation);
  currentComputation.dependencies.set(source, source.version);
}

/**
 * Push 阶段（间接下游）：把下游 memo 从 clean 标为 check 并继续向下传播，把叶子 effect 加入 pendingEffects。
 *
 * @param computation 收到上游“可能变化”信号的下游计算节点。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function markCheck(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  computation: Computation,
): void {
  // 已释放直接跳过；effect 加入 pendingEffects；仅当 memo 当前为 clean 时置为 check、入队 pendingMemos 并递归通知其下游。
  // TODO: 实现 markCheck 的三态传播逻辑。
}

/**
 * Push 阶段（直接下游）：把直接订阅者标为 dirty（effect 则直接入队），并把更下游节点标为 check。
 *
 * @param computation 直接订阅了已变化 signal 的计算节点。
 */
function markDirty(computation: Computation): void {
  // 已释放直接跳过；effect 加入 pendingEffects；memo 若还不是 dirty 则置为 dirty 并对其下游调用 markCheck，同时入队 pendingMemos。
  // TODO: 升级为三态 Push 标脏（置为 dirty、递归 markCheck 下游、入队 pendingMemos）。
  if (computation.disposed) return;
  if (computation.kind === "effect") {
    pendingEffects.add(computation);
    return;
  }
  pendingMemos.add(computation);
}

/**
 * 上游 signal 值变化后触发失效传播：标记直接与间接下游，并在最外层且未刷新时立即执行同步刷新。
 *
 * @param source 版本号刚刚递增的 signal 数据源。
 */
function invalidate(source: Source): void {
  for (const subscriber of source.subscribers) {
    markDirty(subscriber);
  }
  // 排队可以发生在当前计算内，刷新要等到它退出。
  if (batchDepth === 0 && !isFlushing && !currentComputation) {
    flushEffects();
  }
}

/**
 * Pull 阶段版本核对：按上一轮读取顺序检查依赖；遇到上游 memo 先调用 updateMemo 拉取最新状态，只要发现任意依赖版本号变化立即返回 true 短路。
 *
 * @param computation 待确认是否真的需要重算的 memo 或 effect。
 * @returns 是否有至少一个上游依赖版本号发生变化。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function dependenciesChanged(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  computation: Computation,
): boolean {
  // 遍历 computation.dependencies，若上游是 Memo 先调用 updateMemo(source)，一旦 source.version !== observedVersion 立刻短路返回 true。
  // TODO: 实现按读取顺序短路的上游版本核对逻辑。
  return true;
}

/**
 * Pull 阶段按需刷新 memo：dirty 直接重算，check 先核对上游版本（未变则直接切回 clean 跳过重算），clean 或已释放则直接返回。
 *
 * @param memo 需要保证缓存最新一致的 memo 节点。
 */
function updateMemo(memo: Memo): void {
  // 已释放直接返回缓存；未初始化或 dirty 直接调用 runComputation(memo)；check 时仅在 dependenciesChanged(memo) 为真时重算，否则标回 clean。
  // TODO: 补齐 dirty 与 check 状态下的按需拉取与重算逻辑。
  if (memo.disposed) return;
  if (!memo.initialized) {
    runComputation(memo);
  }
}

/**
 * 同步清空待执行队列：先处理 pendingEffects（按需拉取依赖并在版本确实变化时重跑，顺带释放已退出的子分支），再补刷剩余的独立急切 memo。
 */
function flushEffects(): void {
  // 已在刷新中则直接返回；循环先消费 pendingEffects（经 dependenciesChanged 校验），再消费 pendingMemos（经 updateMemo 补刷）；异常时清空两队列并复原 isFlushing。
  // TODO: 改为先消费 pendingEffects（经 dependenciesChanged 校验）再消费 pendingMemos（经 updateMemo 补刷）。
  if (isFlushing) return;
  isFlushing = true;
  try {
    while (pendingMemos.size > 0 || pendingEffects.size > 0) {
      if (pendingMemos.size > 0) {
        const memos = Array.from(pendingMemos);
        pendingMemos.clear();
        for (const memo of memos) {
          if (memo.disposed) continue;
          const prevVersion = memo.version;
          runComputation(memo);
          if (memo.version !== prevVersion) {
            for (const subscriber of memo.subscribers) {
              markDirty(subscriber);
            }
          }
        }
        continue;
      }

      const queue = Array.from(pendingEffects);
      pendingEffects.clear();
      for (const effect of queue) {
        runComputation(effect);
      }
    }
  } catch (error) {
    pendingEffects.clear();
    pendingMemos.clear();
    throw error;
  } finally {
    isFlushing = false;
  }
}

/**
 * 把计算节点从它上一轮订阅过的所有数据源中移除，并清空自身依赖记录。
 *
 * @param computation 即将重跑或待释放的计算节点。
 */
function cleanupDependencies(computation: Computation): void {
  // 逐个通知上一轮读过的数据源删掉当前计算节点，再清空反向 Map，避免旧分支残留订阅。
  for (const source of computation.dependencies.keys()) {
    source.subscribers.delete(computation);
  }
  computation.dependencies.clear();
}

/**
 * 按后进先出顺序释放当前所有权节点下属的全部子作用域，并清空 children 集合。
 *
 * @param errors 本次清理遇到的异常，记录后继续处理其余资源。
 * @param owner 即将重跑或待释放的所有权节点。
 */
function cleanupChildren(owner: Owner, errors: unknown[]): void {
  // 先复制快照并清空 owner.children，再按逆序逐个调用 disposeOwner 递归清理后代。
  const children = Array.from(owner.children);
  owner.children.clear();
  for (const child of children.reverse()) {
    disposeOwner(child, errors);
  }
}

/**
 * 在非追踪上下文中按后进先出顺序执行当前所有权节点登记的清理回调，并清空 cleanups 列表。
 *
 * @param errors 本次清理遇到的异常，记录后继续处理其余资源。
 * @param owner 即将重跑或待释放的所有权节点。
 */
function runCleanups(owner: Owner, errors: unknown[]): void {
  // 先取出并清空 owner.cleanups，再在关闭追踪并置空 currentOwner 的上下文中逆序执行，最后恢复外层上下文。
  if (owner.cleanups.length === 0) return;
  const cleanups = owner.cleanups.splice(0).reverse();
  const previousTracking = tracking;
  const previousOwner = currentOwner;
  tracking = false;
  currentOwner = undefined;
  try {
    for (const cleanup of cleanups) {
      // 回调属于用户代码。记录这次失败后，继续执行下一条清理。
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    tracking = previousTracking;
    currentOwner = previousOwner;
  }
}

/**
 * 标记所有权节点已释放，断开与父节点的关联，递归清理所有子作用域与清理回调并执行自身收尾逻辑；重复调用保持幂等。
 *
 * @param errors 本次清理遇到的异常，记录后继续处理其余资源。
 * @param owner 需要释放的所有权节点。
 */
function disposeOwner(owner: Owner, errors: unknown[]): void {
  // 已经释放过时直接返回，否则先标记 disposed 并从父节点摘除，避免父节点持有死引用。
  if (owner.disposed) return;
  owner.disposed = true;
  owner.parent?.children.delete(owner);
  owner.parent = undefined;
  // 子作用域和回调共用同一个错误列表，任何一条回调抛错后仍要断开自己的订阅。
  cleanupChildren(owner, errors);
  runCleanups(owner, errors);
  owner.onDispose?.();
}

/**
 * 在清理结束后报告异常，只有一个错误时保留原对象。
 * @param errors 本次清理记录的全部异常。
 */
function reportCleanupErrors(errors: unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Reactive cleanup failed");
}

/**
 * 释放作用域并在最后报告异常。回滚使用 disposeOwner 直接记录错误，以便保留原始异常。
 * @param owner 需要完整释放的所有权节点。
 */
function dispose(owner: Owner): void {
  const errors: unknown[] = [];
  disposeOwner(owner, errors);
  reportCleanupErrors(errors);
}

/**
 * 在追踪与所有权上下文中执行计算节点（effect 或 memo）：清理旧依赖、旧子作用域与旧清理回调，重新求值并在 memo 值变化时递增 version；若中途抛错则释放半截资源并恢复外层上下文。
 *
 * @param computation 本轮要执行的 effect 或 memo 节点。
 */
function runComputation(computation: Computation): void {
  // 同一轮队列快照里，前面的计算可能已经释放了当前节点，进入前必须先跳过。
  if (computation.disposed) return;
  // 保存外层追踪与所有权上下文，并在 try/finally 中恢复；若回调抛错，则在 catch 中释放半截订阅与子作用域后继续抛出。
  const previousComputation = currentComputation;
  const previousOwner = currentOwner;
  const previousTracking = tracking;
  currentComputation = computation;
  currentOwner = computation;
  try {
    // 开始新一轮前先完成上一轮的全部清理；清理失败时按执行失败回滚。
    const errors: unknown[] = [];
    cleanupDependencies(computation);
    cleanupChildren(computation, errors);
    runCleanups(computation, errors);
    reportCleanupErrors(errors);
    if (computation.disposed) return;

    // 新计算独立登记依赖，即使它是从 untrack 内启动的。
    tracking = true;
    if (computation.kind === "effect") {
      computation.callback();
    } else {
      // 先复位为 clean 再执行 compute：确保万一求值期间再次被标脏不会被事后覆写。
      computation.state = "clean";
      const nextValue = computation.compute();
      if (!computation.initialized || !Object.is(computation.value, nextValue)) {
        computation.value = nextValue;
        computation.version += 1;
      }
      computation.initialized = true;
    }
  } catch (error) {
    // 回滚半截资源，并让调用者收到触发回滚的原始异常。
    disposeOwner(computation, []);
    // 顶层计算失败后，丢弃这轮留下的待刷新任务。
    if (!previousComputation && batchDepth === 0 && !isFlushing) {
      pendingEffects.clear();
      pendingMemos.clear();
    }
    throw error;
  } finally {
    currentComputation = previousComputation;
    currentOwner = previousOwner;
    tracking = previousTracking;
  }

  // 最外层计算完成后，同步处理执行期间排入的更新。
  if (!currentComputation && batchDepth === 0 && !isFlushing) {
    flushEffects();
  }
}

/**
 * 在当前活跃的所有权作用域上登记一条清理回调；若当前不在任何作用域内，则静默忽略。
 *
 * @param cleanup 作用域重跑前或销毁时需要执行的资源释放函数。
 */
export function onCleanup(cleanup: Dispose): void {
  // 仅当存在未释放的 currentOwner 时登记回调；无 Owner 上下文时静默跳过，避免独立构造节点报错。
  if (currentOwner && !currentOwner.disposed) {
    currentOwner.cleanups.push(cleanup);
  }
}

/**
 * 暂时关闭依赖追踪执行回调：内部读到的 signal 与 memo 不会登记为外层计算的依赖，但仍保留当前活跃的 Owner 所有权作用域。
 *
 * @param fn 不希望建立依赖追踪的同步回调函数。
 * @returns fn 的返回值。
 */
export function untrack<T>(fn: () => T): T {
  // 只暂停依赖登记，让当前计算和所有权保持不变，最后恢复追踪开关。
  // TODO: 保存 tracking，设为 false 后调用 fn，再通过 finally 恢复。
  return fn();
}

/**
 * 创建一个独立的可释放根作用域：不挂入外层所有权树且屏蔽外层依赖追踪，在 setup 抛错时自动回滚已登记资源并原样重抛。
 *
 * @param setup 接收根作用域 dispose 句柄的初始化函数。
 * @returns setup 函数的返回值。
 */
export function createRoot<T>(setup: (dispose: Dispose) => T): T {
  // 建立独立的 root Owner，在暂停追踪并切换到 root，初始化抛错时完成回滚并保留原始异常。
  const root: Owner = {
    parent: undefined,
    children: new Set(),
    cleanups: [],
    disposed: false,
  };
  const disposeRoot: Dispose = () => dispose(root);
  const previousTracking = tracking;
  const previousOwner = currentOwner;
  tracking = false;
  currentOwner = root;
  try {
    return setup(disposeRoot);
  } catch (error) {
    // 初始化异常是失败的原因，回滚产生的清理异常不能覆盖它。
    disposeOwner(root, []);
    throw error;
  } finally {
    tracking = previousTracking;
    currentOwner = previousOwner;
  }
}

/**
 * 立即执行一次回调，让内部读取到的 signal 或 memo 自动把回调登记为依赖，并将当前 effect 归入活跃的 Owner，返回停止订阅的释放函数。
 *
 * @param callback 读取 signal 并执行副作用的回调函数。
 * @returns 调用后即可退订并释放该 effect 及其后代的释放函数。
 */
export function createEffect(callback: EffectCallback): Dispose {
  const effect: Effect = {
    kind: "effect",
    parent: currentOwner,
    children: new Set(),
    cleanups: [],
    disposed: false,
    callback,
    dependencies: new Map(),
  };
  effect.onDispose = () => {
    cleanupDependencies(effect);
    pendingEffects.delete(effect);
  };

  // 若存在未释放的父作用域，把当前 effect 挂入其 children，便于父作用域重跑或销毁时统一回收。
  if (currentOwner && !currentOwner.disposed) {
    currentOwner.children.add(effect);
  }

  runComputation(effect);
  return () => dispose(effect);
}

/**
 * 创建一个三态 Push-Pull 派生节点：写入时仅标脏，读取或刷新下游时按需核对上游版本并缓存结果，仅当新旧值按 Object.is 不同时递增版本号，并随当前 Owner 自动释放。
 *
 * @param compute 读取上游 signal 或 memo 并返回派生结果的纯计算函数。
 * @returns 读取当前最新一致缓存值的 getter（在计算节点内读取时会订阅该派生节点）。
 */
export function createMemo<T>(compute: () => T): () => T {
  const memo: Memo<T> = {
    kind: "memo",
    parent: currentOwner,
    children: new Set(),
    cleanups: [],
    disposed: false,
    dependencies: new Map(),
    subscribers: new Set(),
    version: 0,
    compute,
    value: undefined,
    initialized: false,
    state: "dirty",
  };
  memo.onDispose = () => {
    cleanupDependencies(memo);
    pendingMemos.delete(memo);
    memo.subscribers.clear();
  };

  // 若存在未释放的父作用域，把当前 memo 挂入其 children，随父作用域销毁一并退订。
  if (currentOwner && !currentOwner.disposed) {
    currentOwner.children.add(memo);
  }

  // 默认急切求值：创建时立即计算首版缓存，确保初始化抛错第一时间暴露。
  updateMemo(memo);

  return function get(): T {
    // 先按需刷新确保 memo.value 与 memo.version 为最新一致状态，再向当前外层计算登记订阅。
    updateMemo(memo);
    track(memo);
    return memo.value as T;
  };
}

/**
 * 在同步作用域内合并多次 signal 写入：批次内每次写入立即生效且可直接读到最新值，所有受影响的 effect 推迟到最外层 batch 结束时去重统一执行。
 *
 * @param fn 包含一组状态写入的同步回调函数。
 * @returns fn 的返回值。
 */
export function batch<T>(fn: () => T): T {
  // 递增 batchDepth 执行 fn，在 finally 中递减深度并在最外层且未刷新时触发 flushEffects；若 fn 已抛错则优先保留原始回调异常。
  batchDepth += 1;
  let hasCallbackError = false;
  let callbackError: unknown;
  let result!: T;
  try {
    result = fn();
  } catch (error) {
    hasCallbackError = true;
    callbackError = error;
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0 && !isFlushing && !currentComputation) {
      if (hasCallbackError) {
        try {
          flushEffects();
        } catch {
          // 回调已抛错时仍要刷新此前已写入的状态，若刷新本身再抛错则优先保留原始回调异常。
        }
      } else {
        flushEffects();
      }
    }
  }
  if (hasCallbackError) {
    throw callbackError;
  }
  return result;
}

/**
 * 把值留在一次调用独有的闭包里，交给同一组读写函数访问。
 *
 * @param initialValue 创建时保存的初始值，也决定读写函数使用的类型。
 * @returns getter 和 setter 组成的元组。
 */
export function createSignal<T>(initialValue: T) {
  let value = initialValue;
  // 保存依赖这个 signal 的计算节点集合与单调递增的版本号。
  const source: Source = {
    subscribers: new Set(),
    version: 0,
  };

  /**
   * 读取当前闭包里保存的值，并在未释放的计算节点执行期间建立双向依赖关系。
   *
   * @returns 最新状态。
   */
  function get(): T {
    track(source);
    return value;
  }

  /**
   * 仅在新旧值不同时更新闭包、递增版本号并触发失效传播。
   *
   * @param next 要写入的新值。
   */
  function set(next: T): void {
    // 新旧值相同时直接返回，避免无意义的重复通知（Object.is 同时正确处理 NaN 和 +0 / -0）。
    if (Object.is(value, next)) return;
    // 先更新值并递增版本号，下游 Pull 核对和读值时才能立刻看到这次写入的结果。
    value = next;
    source.version += 1;
    invalidate(source);
  }

  return [get, set] as const;
}
