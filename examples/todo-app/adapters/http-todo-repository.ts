import type { AsyncTodoRepository } from "../async-repository.ts";
import { parseTodos } from "../storage.ts";

/**
 * 把 Store 的读写请求翻译成 HTTP。本地开发时 Vite 将 API 转发给 Todo 后端。
 * @param url Todo 接口地址，测试可传入临时服务的完整地址。
 * @returns 支持取消的 HTTP Todo 仓库。
 */
export function createHttpTodoRepository(url = "/api/todos"): AsyncTodoRepository {
  return {
    async load(signal) {
      // fetch 成功返回响应也可能拿到 4xx 或 5xx。确认成功后才把响应当作列表读入。
      const response = await fetch(url, { method: "GET", signal });
      if (!response.ok) throw new Error(`读取任务失败：HTTP ${response.status}`);

      // HTTP 仓库保存的是整份列表。坏数据应报告读取失败，以免遗漏的条目被后续保存覆盖。
      const result = parseTodos(await response.text());
      if (result.skippedCount > 0) throw new Error("后端返回的任务列表无效");
      return result.todos;
    },
    async save(snapshot, signal) {
      // 发送这次的快照，并检查服务端是否确认写入。
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
        signal,
      });
      if (!response.ok) throw new Error(`保存任务失败：HTTP ${response.status}`);
    },
  };
}
