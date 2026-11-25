// Todo 示例应用组合根：唯一负责选择具体浏览器存储适配器、创建 TodoStore 并注入 <App /> 的入口文件。
import { render } from "nano-solid";
import { App } from "./App.tsx";
import { createLocalTodoStorage } from "./adapters/local-todo-storage.ts";
import { createTodoStore } from "./todo-store.ts";

const app = document.querySelector<HTMLElement>("#app");

if (app) {
  // 在 render 根作用域内创建 store，确保卸载时自动释放全部派生 memo 与自动保存 effect。
  render(() => {
    const storage = createLocalTodoStorage();
    const store = createTodoStore(storage);
    return <App store={store} />;
  }, app);
}
