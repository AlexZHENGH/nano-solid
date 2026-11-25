import { render, type Dispose } from "nano-solid";
import { AsyncApp } from "./AsyncApp.tsx";
import { createMemoryAsyncTodoRepository } from "./adapters/memory-async-todo-repository.ts";
import { createAsyncTodoStore } from "./async-todo-store.ts";
import { INITIAL_TODOS } from "./types.ts";

const container = document.querySelector<HTMLElement>("#app");
const reopen = document.querySelector<HTMLButtonElement>("#reopen-app");

if (container && reopen) {
  // 内存仓库比一次挂载活得久，所以重新打开时还能读到已经确认的数据。
  const repository = createMemoryAsyncTodoRepository(INITIAL_TODOS);

  /** 把每次新建的 Store 归给 render 的根作用域，卸载即可取消这轮读写。 */
  const mount = (): Dispose =>
    render(() => <AsyncApp store={createAsyncTodoStore(repository)} />, container);
  let dispose = mount();

  // 先销毁旧视图及其工作，再从同一个仓库加载一份新视图。
  reopen.addEventListener("click", () => {
    dispose();
    dispose = mount();
  });
}
