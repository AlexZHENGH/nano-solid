/** 会随读取过的 signal 变化而重新执行的副作用函数。 */
type Effect = () => void;
/** 记录当前同步执行中的 effect，getter 靠它知道这次读取该登记给谁。 */
let currentEffect: Effect | undefined;

/**
 * 在追踪上下文中执行回调，并在退出时恢复外层记录。
 *
 * @param effect 本轮要执行的副作用回调。
 */
function runEffect(effect: Effect): void {
  // 保存外层 effect，并在 try/finally 中恢复，避免嵌套或抛错后残留旧引用。
  const previous = currentEffect;
  currentEffect = effect;
  try {
    effect();
  } finally {
    currentEffect = previous;
  }
}

/**
 * 立即执行一次回调，让内部读取到的 signal 自动把回调登记为依赖。
 *
 * @param effect 读取 signal 并执行副作用的回调函数。
 */
export function createEffect(effect: Effect): void {
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
   * 读取当前闭包里保存的值，并在 effect 执行期间登记依赖。
   *
   * @returns 最新状态。
   */
  function get(): T {
    // 只有在同步执行中的 effect 读值时，才把它加入当前 signal 的订阅集合。
    if (currentEffect) {
      subscribers.add(currentEffect);
    }
    return value;
  }

  /**
   * 先把新值写回闭包，再通知所有依赖这个 signal 的 effect 重新执行。
   *
   * @param next 要写入的新值。
   */
  function set(next: T): void {
    // 先更新值，effect 重跑时调用 get() 才能读到这次写入的结果。
    value = next;
    for (const subscriber of subscribers) {
      runEffect(subscriber);
    }
  }

  return [get, set] as const;
}
