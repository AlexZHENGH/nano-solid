// Todo 示例应用入口：仅依赖框架公共入口 "#nano-solid"，不直接触碰 src/ 内部实现文件。
import { render } from "#nano-solid";
import { App } from "./App.tsx";

const app = document.querySelector<HTMLElement>("#app");

if (app) {
  render(() => <App />, app);
}
