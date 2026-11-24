// 浏览器入口：为 index.html 中的计数器骨架绑定响应式状态与事件。
import { mountCounter } from "./counter.ts";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  mountCounter(app);
}
