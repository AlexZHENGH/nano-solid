/**
 * 把值留在一次调用独有的闭包里，交给同一组读写和订阅函数访问。
 *
 * @param initialValue 创建时保存的初始值，也决定读写函数使用的类型。
 * @returns getter、setter 和手动订阅函数组成的元组。
 */
export function createSignal<T>(initialValue: T) {
  let value = initialValue;
  // 保存关心这个 signal 变化的回调集合。
  const subscribers = new Set<() => void>();

  /**
   * 读取当前闭包里保存的值。
   *
   * @returns 最新状态。
   */
  function get(): T {
    return value;
  }

  /**
   * 先把新值写回闭包，再通知所有已登记的订阅者。
   *
   * @param next 要写入的新值。
   */
  function set(next: T): void {
    // 先更新值，回调里再调用 get() 才能读到这次写入的结果。
    value = next;
    for (const subscriber of subscribers) {
      subscriber();
    }
  }

  /**
   * 手动登记一个回调，让它在这个 signal 写入新值后收到通知。
   *
   * @param callback 每次写入后要执行的函数。
   */
  function subscribe(callback: () => void): void {
    // 用 Set 存回调，同一个函数引用重复登记时只保留一份。
    subscribers.add(callback);
  }

  return [get, set, subscribe] as const;
}
