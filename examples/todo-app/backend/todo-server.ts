import { createServer, type Server, type ServerResponse } from "node:http";
import { parseTodos } from "../storage.ts";
import { INITIAL_TODOS, type Todo } from "../types.ts";

/** 限制一份任务列表占用的请求体空间。 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * 发送任务快照或错误详情。每次读取都让浏览器向服务端确认当前内容。
 * @param response 本次请求的响应。
 * @param status HTTP 状态码。
 * @param data 要编码为 JSON 的任务列表或错误。
 */
function replyJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

/**
 * 创建只在内存保存最新快照的 Todo 后端。调用方决定何时启动和关闭服务。
 * @param initial 服务启动时已有的任务。
 * @returns 提供 GET 和 PUT /api/todos 的 HTTP 服务。
 */
export function createTodoServer(initial: readonly Todo[] = INITIAL_TODOS): Server {
  // 这份列表由服务持有，浏览器重新打开应用时可以继续读取。
  let todos = initial.map((todo) => ({ ...todo }));

  return createServer(async (request, response) => {
    // 这里只处理一个资源。GET 返回当前快照，PUT 提交整份替换数据。
    if (request.url !== "/api/todos") {
      replyJson(response, 404, { error: "找不到资源" });
      return;
    }
    if (request.method === "GET") {
      replyJson(response, 200, todos);
      return;
    }
    if (request.method !== "PUT") {
      response.setHeader("Allow", "GET, PUT");
      replyJson(response, 405, { error: "此接口只接受 GET 或 PUT" });
      return;
    }

    // 请求体会分块到达。在上限内收集，超过上限后继续读完，但不再保存新的块。
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size <= MAX_BODY_BYTES) chunks.push(chunk);
      }
    } catch {
      // 客户端在请求体完整到达前断开，服务保留上次确认的任务。
      if (!response.destroyed) replyJson(response, 400, { error: "请求体读取失败" });
      return;
    }
    if (size > MAX_BODY_BYTES) {
      replyJson(response, 413, { error: "任务列表过大" });
      return;
    }

    // 和本地存储共用校验。任一条任务无效时拒绝整次写入，保留原快照。
    try {
      const next = parseTodos(Buffer.concat(chunks).toString("utf8"));
      if (next.skippedCount > 0) throw new Error("任务字段无效或编号重复");
      todos = next.todos;
    } catch {
      replyJson(response, 400, { error: "需要有效且编号不重复的任务数组" });
      return;
    }

    // 仓库已经接收整份数据。用 204 确认，客户端不需要再解析响应体。
    response.writeHead(204).end();
  });
}

// 直接运行文件时启动本地服务，测试导入时则可以选择空闲端口。
if (import.meta.main) {
  createTodoServer().listen(8787, "127.0.0.1", () => {
    console.log("Todo 后端就绪。http://127.0.0.1:8787/api/todos");
  });
}
