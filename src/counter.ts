import { createEffect, createSignal, type Dispose } from "./reactive.ts";

/**
 * 为页面上已有的计数器 DOM 绑定响应式状态与按钮事件，并返回对应的清理函数。
 *
 * @param root 包含 #counter、#increment、#decrement、#reset 的容器节点。
 * @returns 停止订阅并移除按钮事件监听的清理函数。
 */
export function mountCounter(root: ParentNode): Dispose {
  const counter = root.querySelector<HTMLElement>("#counter");
  const incrementButton = root.querySelector<HTMLButtonElement>("#increment");
  const decrementButton = root.querySelector<HTMLButtonElement>("#decrement");
  const resetButton = root.querySelector<HTMLButtonElement>("#reset");

  if (!counter || !incrementButton || !decrementButton || !resetButton) {
    throw new Error("缺少计数器所需的 DOM 元素");
  }

  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const [count, setCount] = createSignal(0);

  // 把当前计数同步到页面上的 #counter 文本，保证信号变化时自动刷新显示。
  const disposeEffect = createEffect(() => {
    counter.textContent = String(count());
  });

  // 点击 +1、-1、重置按钮时更新 signal，由上面的 effect 驱动 DOM 更新。
  // TODO: 定义三个点击处理函数，并用 addEventListener 分别绑定到 incrementButton、decrementButton、resetButton。

  return () => {
    disposeEffect();
    // 卸载时成对移除事件监听，避免节点移除或重复挂载后泄漏监听函数。
    // TODO: 用 removeEventListener 移除上面注册的三个点击处理函数。
  };
}
