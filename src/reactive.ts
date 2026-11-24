/** 会随读取过的 signal 变化而重新执行的副作用函数。 */
export type EffectCallback = () => void;

/**
 * 内部维护的 effect 节点：除了用户回调外，还反向记录它登记在哪些 signal 的 subscribers 中。
 */
type Effect = {
  callback: EffectCallback;
  dependencies: Set<Set<Effect>>;
};

/** 记录当前同步执行中的 effect，getter 靠它知道这次读取该登记给谁。 */
let currentEffect: Effect | undefined;

/**
 * 把 effect 从它上一轮订阅过的所有 signal 中移除，并清空自身依赖记录。
 *
 * @param effect 即将重跑的 effect 节点。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function cleanupDependencies(effect: Effect): void {
  // 逐个通知上一轮读过的 signal 删掉当前 effect，再清空反向集合，避免旧分支残留订阅。
  // TODO: 遍历 effect.dependencies，把 effect 从每个 subscribers 中删除，然后清空 effect.dependencies。
}

/**
 * 在追踪上下文中执行 effect：先清理上一轮依赖，再运行回调重建本轮订阅，并在退出时恢复外层记录。
 *
 * @param effect 本轮要执行的 effect 节点。
 */
function runEffect(effect: Effect): void {
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
 * 立即执行一次回调，让内部读取到的 signal 自动把回调登记为依赖。
 *
 * @param callback 读取 signal 并执行副作用的回调函数。
 */
export function createEffect(callback: EffectCallback): void {
  const effect: Effect = {
    callback,
    dependencies: new Set(),
  };
  runEffect(effect);
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
   * 读取当前闭包里保存的值，并在 effect 执行期间建立双向依赖关系。
   *
   * @returns 最新状态。
   */
  function get(): T {
    // 只有在同步执行中的 effect 读值时，才把它和当前 signal 互相登记。
    if (currentEffect) {
      subscribers.add(currentEffect);
      // 反向记录当前 signal 的 subscribers 集合，方便下次重跑前精准清理旧依赖。
      // TODO: 把 subscribers 加入 currentEffect.dependencies。
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
