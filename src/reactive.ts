/**
 * 把值留在一次调用独有的闭包里，交给同一组读写函数访问。
 *
 * @param initialValue 创建时保存的初始值，也决定读写函数使用的类型。
 * @returns getter 和 setter 组成的元组。
 */
export function createSignal<T>(initialValue: T) {
  let value = initialValue;

  /**
   * 读取当前闭包里保存的值。
   *
   * @returns 最新状态。
   */
  function get(): T {
    return value;
  }

  /**
   * 把新值写回 getter 读取的同一个闭包。
   *
   * @param next 要写入的新值。
   */
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  function set(next: T): void {
    // 更新 get() 下一次读取的同一个局部变量。
    // TODO: 把 next 写入 value。
  }

  return [get, set] as const;
}
