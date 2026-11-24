/** 会随读取过的 signal 变化而重新执行的副作用函数。 */
export type EffectCallback = () => void;

/** 用于停止一个 effect 订阅并释放依赖的清理函数。 */
export type Dispose = () => void;

/**
 * 内部维护的 effect 节点：保存用户回调、反向依赖集合，以及是否已经释放的状态。
 */
type Effect = {
  callback: EffectCallback;
  dependencies: Set<Set<Effect>>;
  disposed: boolean;
};

/** 记录当前同步执行中的 effect，getter 靠它知道这次读取该登记给谁。 */
let currentEffect: Effect | undefined;

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
 * 标记 effect 已释放并断开它持有的所有 signal 订阅，重复调用保持幂等。
 *
 * @param effect 需要停止响应的 effect 节点。
 */
function disposeEffect(effect: Effect): void {
  // 已经释放过时直接返回，否则标记 disposed 并清理全部双向订阅。
  if (effect.disposed) return;
  effect.disposed = true;
  cleanupDependencies(effect);
}

/**
 * 在追踪上下文中执行 effect：跳过已释放节点，先清理上一轮依赖，再运行回调重建本轮订阅，并在退出时恢复外层记录。
 *
 * @param effect 本轮要执行的 effect 节点。
 */
function runEffect(effect: Effect): void {
  // 同一轮通知快照里，前面的 effect 可能已经释放了当前节点，进入前必须先跳过。
  if (effect.disposed) return;
  cleanupDependencies(effect);
  // 保存外层 effect，并在 try/finally 中恢复，避免嵌套或抛错后残留旧引用。
  const previous = currentEffect;
  currentEffect = effect;
  try {
    effect.callback();
  } finally {
    currentEffect = previous;
  }
}

/**
 * 立即执行一次回调，让内部读取到的 signal 自动把回调登记为依赖，并返回停止订阅的释放函数。
 *
 * @param callback 读取 signal 并执行副作用的回调函数。
 * @returns 调用后即可退订并停止该 effect 的释放函数。
 */
export function createEffect(callback: EffectCallback): Dispose {
  const effect: Effect = {
    callback,
    dependencies: new Set(),
    disposed: false,
  };
  runEffect(effect);
  return () => disposeEffect(effect);
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
