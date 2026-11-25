import { render, type Dispose } from "nano-solid";
import { App } from "../App.tsx";
import { createLocalTodoStorage } from "../adapters/local-todo-storage.ts";
import type { TodoStorage } from "../storage.ts";
import { createTodoStore } from "../todo-store.ts";

/**
 * 测试辅助装配函数：模拟组合根 main.tsx 的装配方式，在 render 根作用域内创建 TodoStore 并挂载 <App />。
 *
 * @param container 挂载目标 DOM 容器。
 * @param storage 可选存储适配器，未传时默认使用浏览器 localStorage 适配器。
 * @returns 卸载整个应用的 dispose 函数。
 */
export function mountTodoApp(container: HTMLElement, storage?: TodoStorage): Dispose {
  return render(() => {
    const store = createTodoStore(storage ?? createLocalTodoStorage());
    return <App store={store} />;
  }, container);
}
