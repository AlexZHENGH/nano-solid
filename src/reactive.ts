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
 * 内部维护的 effect 节点：同时是一个 Owner，保存用户回调与反向依赖集合。
 */
type Effect = Owner & {
  callback: EffectCallback;
  dependencies: Set<Set<Effect>>;
};

/** 记录当前同步执行中的 effect，getter 靠它知道这次读取该登记给谁。 */
let currentEffect: Effect | undefined;

/** 记录当前活跃的所有权作用域，新创建的子 effect 与清理回调会自动归属于它。 */
let currentOwner: Owner | undefined;

/**
 * 把 effect 从它上一轮订阅过的所有 signal 中移除，并清空自身依赖记录。
 *
 * @param effect 即将重跑或待释放的 effect 节点。
 */
function cleanupDependencies(effect: Effect): void {
  // 逐个通知上一轮读过的 signal 删掉当前 effect，再清空反向集合，避免旧分支残留订阅。
  for (const subscribers of effect.dependencies) {
    subscribers.delete(effect);
  }
  effect.dependencies.clear();
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
  // 先取出并清空 owner.cleanups，再在置空 currentEffect / currentOwner 的上下文中逆序执行，最后恢复外层上下文。
  if (owner.cleanups.length === 0) return;
  const cleanups = owner.cleanups.splice(0).reverse();
  const previousEffect = currentEffect;
  const previousOwner = currentOwner;
  currentEffect = undefined;
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
    currentEffect = previousEffect;
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
 * 在追踪与所有权上下文中执行 effect：跳过已释放节点，清理上一轮依赖、子作用域与清理回调，运行回调重建本轮订阅；若中途抛错则释放半截资源，最后恢复外层上下文。
 *
 * @param effect 本轮要执行的 effect 节点。
 */
function runEffect(effect: Effect): void {
  // 同一轮通知快照里，前面的 effect 可能已经释放了当前节点，进入前必须先跳过。
  if (effect.disposed) return;
  // 保存外层追踪与所有权上下文，并在 try/finally 中恢复；若回调抛错，则在 catch 中释放半截订阅与子作用域后继续抛出。
  const previousEffect = currentEffect;
  const previousOwner = currentOwner;
  currentEffect = effect;
  currentOwner = effect;
  try {
    // 开始新一轮前先完成上一轮的全部清理；清理失败时按执行失败回滚。
    const errors: unknown[] = [];
    cleanupDependencies(effect);
    cleanupChildren(effect, errors);
    runCleanups(effect, errors);
    reportCleanupErrors(errors);
    if (effect.disposed) return;

    effect.callback();
  } catch (error) {
    // 回滚半截资源，并让调用者收到触发回滚的原始异常。
    disposeOwner(effect, []);
    throw error;
  } finally {
    currentEffect = previousEffect;
    currentOwner = previousOwner;
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
 * 创建一个独立的可释放根作用域：不挂入外层所有权树且屏蔽外层依赖追踪，在 setup 抛错时自动回滚已登记资源并原样重抛。
 *
 * @param setup 接收根作用域 dispose 句柄的初始化函数。
 * @returns setup 函数的返回值。
 */
export function createRoot<T>(setup: (dispose: Dispose) => T): T {
  // 建立独立的 root Owner，在暂存外层 currentEffect / currentOwner 后置空追踪上下文并切换到 root，初始化抛错时完成回滚并保留原始异常。
  const root: Owner = {
    parent: undefined,
    children: new Set(),
    cleanups: [],
    disposed: false,
  };
  const disposeRoot: Dispose = () => dispose(root);
  const previousEffect = currentEffect;
  const previousOwner = currentOwner;
  currentEffect = undefined;
  currentOwner = root;
  try {
    return setup(disposeRoot);
  } catch (error) {
    // 初始化异常是失败的原因，回滚产生的清理异常不能覆盖它。
    disposeOwner(root, []);
    throw error;
  } finally {
    currentEffect = previousEffect;
    currentOwner = previousOwner;
  }
}

/**
 * 立即执行一次回调，让内部读取到的 signal 自动把回调登记为依赖，并将当前 effect 归入活跃的 Owner，返回停止订阅的释放函数。
 *
 * @param callback 读取 signal 并执行副作用的回调函数。
 * @returns 调用后即可退订并释放该 effect 及其后代的释放函数。
 */
export function createEffect(callback: EffectCallback): Dispose {
  const effect: Effect = {
    parent: currentOwner,
    children: new Set(),
    cleanups: [],
    disposed: false,
    callback,
    dependencies: new Set(),
  };
  effect.onDispose = () => cleanupDependencies(effect);

  // 若存在未释放的父作用域，把当前 effect 挂入其 children，便于父作用域重跑或销毁时统一回收。
  if (currentOwner && !currentOwner.disposed) {
    currentOwner.children.add(effect);
  }

  runEffect(effect);
  return () => dispose(effect);
}

/**
 * 创建一个带缓存的派生状态：依赖变化时重新计算，仅当新旧结果按 Object.is 不同时通知下游，并随当前 Owner 自动释放。
 *
 * @param compute 读取上游 signal 并返回派生结果的纯计算函数。
 * @returns 读取当前缓存值的 getter（在 effect 内读取时会订阅该派生状态）。
 */
export function createMemo<T>(compute: () => T): () => T {
  // 用内部 signal 存缓存值，并用 createEffect 驱动重算；首次执行先初始化缓存，后续通过 set 复用 Object.is 同值截断。
  let initialized = false;
  let get!: () => T;
  let set!: (next: T) => void;

  createEffect(() => {
    const next = compute();
    if (!initialized) {
      initialized = true;
      [get, set] = createSignal(next);
    } else {
      set(next);
    }
  });

  return () => get();
}

/**
 * 把值留在一次调用独有的闭包里，交给同一组读写函数访问。
 *
 * @param initialValue 创建时保存的初始值，也决定读写函数使用的类型。
 * @returns getter 和 setter 组成的元组。
 */
export function createSignal<T>(initialValue: T) {
  let value = initialValue;
  // 保存依赖这个 signal 的 effect 集合。
  const subscribers = new Set<Effect>();

  /**
   * 读取当前闭包里保存的值，并在未释放的 effect 执行期间建立双向依赖关系。
   *
   * @returns 最新状态。
   */
  function get(): T {
    // 只有在同步执行中的 effect 读值时，才把它和当前 signal 互相登记。
    if (currentEffect) {
      // effect 在回调中途自释放后，后续读值不应把它重新挂回 subscribers。
      if (currentEffect.disposed) return value;
      subscribers.add(currentEffect);
      // 反向记录当前 signal 的 subscribers 集合，方便下次重跑前精准清理旧依赖。
      currentEffect.dependencies.add(subscribers);
    }
    return value;
  }

  /**
   * 仅在新旧值不同时更新闭包并通知依赖这个 signal 的 effect 重新执行。
   *
   * @param next 要写入的新值。
   */
  function set(next: T): void {
    // 新旧值相同时直接返回，避免无意义的重复通知（Object.is 同时正确处理 NaN 和 +0 / -0）。
    if (Object.is(value, next)) return;
    // 先更新值，effect 重跑时调用 get() 才能读到这次写入的结果。
    value = next;
    // 复制本轮订阅者快照：runEffect 会先删掉旧订阅再重新登记，直接遍历原 Set 会陷入死循环。
    for (const subscriber of Array.from(subscribers)) {
      runEffect(subscriber);
    }
  }

  return [get, set] as const;
}
