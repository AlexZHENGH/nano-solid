import { render, type Dispose } from "nano-solid";
import { AsyncApp } from "./AsyncApp.tsx";
import type { AsyncTodoRepository } from "./async-repository.ts";
import { createAsyncTodoStore } from "./async-todo-store.ts";

/**
 * 挂载异步 Todo，并让“重新打开应用”保留同一个仓库。
 * @param repository 由页面入口选择的内存或 HTTP 仓库。
 */
export function mountAsyncTodo(repository: AsyncTodoRepository): void {
  const container = document.querySelector<HTMLElement>("#app");
  const reopen = document.querySelector<HTMLButtonElement>("#reopen-app");
  if (!container || !reopen) return;

  /** 创建一份归当前根作用域管理的 Store，卸载时可以停止这轮读写。 */
  const mount = (): Dispose =>
    render(() => <AsyncApp store={createAsyncTodoStore(repository)} />, container);
  let dispose = mount();

  // 先关闭旧视图和它的工作，再用同一仓库装入新的视图。
  reopen.addEventListener("click", () => {
    dispose();
    dispose = mount();
  });
}
