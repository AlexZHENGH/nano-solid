import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpTodoRepository } from "./adapters/http-todo-repository.ts";
import { createTodoServer } from "./backend/todo-server.ts";
import type { Todo } from "./types.ts";

/** 读写各自使用一份任务快照，便于看出服务何时提交替换。 */
const initial: readonly Todo[] = [{ id: 1, text: "订会议室", completed: false }];
const completed: readonly Todo[] = [{ id: 1, text: "订会议室", completed: true }];

describe("HTTP Todo 仓库和后端", () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    // 使用真实的 HTTP 服务和空闲端口，让每个用例都能独立运行。
    server = createTodoServer(initial).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("服务未监听 TCP 端口");
    url = `http://127.0.0.1:${address.port}/api/todos`;
  });

  afterEach(async () => {
    // 等待监听端口关闭，失败的用例也不会留下后台服务。
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("通过 GET 读取服务端持有的任务", async () => {
    const repository = createHttpTodoRepository(url);
    expect(await repository.load(new AbortController().signal)).toEqual(initial);
  });

  it("读取不存在的资源时拒绝 HTTP 错误，不把错误响应当作快照", async () => {
    // 对不存在的路径发真实请求，服务会返回包含错误详情的 JSON。
    const repository = createHttpTodoRepository(`${url}/missing`);
    await expect(repository.load(new AbortController().signal)).rejects.toThrow("HTTP 404");
  });

  it("服务拒绝错误 JSON 或重复编号，已有任务保持原样", async () => {
    // 直接通过 HTTP 发送坏数据，让服务端负责检查整份列表。
    for (const body of ["[", JSON.stringify([...initial, ...completed])]) {
      const response = await fetch(url, { method: "PUT", body });
      expect(response.status).toBe(400);
    }
    const response = await fetch(url);
    expect(await response.json()).toEqual(initial);
  });

  it("服务拒绝超过上限的任务列表，已有任务保持原样", async () => {
    // 使用合法但体积超限的 JSON，另行覆盖请求体大小限制。
    const body = JSON.stringify([{ id: 1, text: "x".repeat(1024 * 1024), completed: true }]);
    const response = await fetch(url, { method: "PUT", body });
    expect(response.status).toBe(413);
    expect(await (await fetch(url)).json()).toEqual(initial);
  });

  it("发送任务快照并等待确认，另一份仓库实例能读回这次保存", async () => {
    // 用两个仓库实例模仿关闭页面后再次打开，确认任务存放在服务端。
    await createHttpTodoRepository(url).save(completed, new AbortController().signal);
    expect(await createHttpTodoRepository(url).load(new AbortController().signal)).toEqual(
      completed,
    );
  });

  it("服务拒绝保存时，仓库把失败交还给 Store 处理", async () => {
    // 编号校验由服务执行，用协议不接受的编号触发真正的 HTTP 400。
    const repository = createHttpTodoRepository(url);
    const signal = new AbortController().signal;
    await expect(
      repository.save([{ id: 0, text: "无效编号", completed: true }], signal),
    ).rejects.toThrow("HTTP 400");
    expect(await repository.load(signal)).toEqual(initial);
  });

  it("把取消信号交给 fetch，已经取消的保存不会发出", async () => {
    // 先取消再调用 save。信号漏传时请求会成功，并把已完成的快照写进去。
    const repository = createHttpTodoRepository(url);
    const signal = AbortSignal.abort();
    await expect(repository.save(completed, signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await repository.load(new AbortController().signal)).toEqual(initial);
  });
});
