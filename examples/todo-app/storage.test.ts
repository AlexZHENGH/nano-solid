// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createLocalTodoStorage } from "./adapters/local-todo-storage.ts";
import { DEFAULT_STORAGE_KEY, loadTodosFromStorage, parseTodos } from "./storage.ts";
import { createMemoryTodoStorage } from "./test-support/memory-todo-storage.ts";
import { INITIAL_TODOS } from "./types.ts";

describe("Todo 存储解析与适配", () => {
  afterEach(() => {
    window.localStorage.removeItem(DEFAULT_STORAGE_KEY);
  });

  it("parseTodos 解析合法数组并返回新对象拷贝，保留空数组 []", () => {
    expect(parseTodos("[]")).toEqual({ todos: [], skippedCount: 0 });

    const result = parseTodos(
      JSON.stringify([
        { id: 1, text: "第一项", completed: false },
        { id: 5, text: "第五项", completed: true },
      ]),
    );
    expect(result).toEqual({
      todos: [
        { id: 1, text: "第一项", completed: false },
        { id: 5, text: "第五项", completed: true },
      ],
      skippedCount: 0,
    });
  });

  it("parseTodos 遇到非法 JSON 或非数组根节点时抛错", () => {
    expect(() => parseTodos("{broken json")).toThrow();
    expect(() => parseTodos('{"id": 1}')).toThrow("Stored todos must be an array");
    expect(() => parseTodos("123")).toThrow("Stored todos must be an array");
  });

  it("parseTodos 逐项校验字段（正安全整数 id、字符串 text、布尔 completed）并跳过非法项", () => {
    const raw = JSON.stringify([
      { id: 1, text: "合法任务", completed: false },
      null,
      "not-an-object",
      { id: 0, text: "非正数 id", completed: false },
      { id: -2, text: "负数 id", completed: false },
      { id: 1.5, text: "小数 id", completed: false },
      { id: 2, text: 123, completed: false },
      { id: 3, text: "缺 completed" },
      { id: 4, text: "合法任务二", completed: true },
    ]);

    expect(parseTodos(raw)).toEqual({
      todos: [
        { id: 1, text: "合法任务", completed: false },
        { id: 4, text: "合法任务二", completed: true },
      ],
      skippedCount: 7,
    });
  });

  it("parseTodos 对重复 id 保留首条合法记录并累计 skippedCount", () => {
    const raw = JSON.stringify([
      { id: 2, text: 999, completed: false }, // 非法项，不应抢占 id=2
      { id: 2, text: "首条合法记录", completed: false },
      { id: 2, text: "重复的合法记录", completed: true },
    ]);

    expect(parseTodos(raw)).toEqual({
      todos: [{ id: 2, text: "首条合法记录", completed: false }],
      skippedCount: 2,
    });
  });

  it("loadTodosFromStorage 区分缺键、部分损坏与读失败三种场景", () => {
    // 1. 缺键：回退到默认任务，无警告、未失败。
    const emptyStorage = createMemoryTodoStorage({ initialRaw: null });
    expect(loadTodosFromStorage(emptyStorage)).toEqual({
      todos: INITIAL_TODOS.map((todo) => ({ ...todo })),
      warning: null,
      loadFailed: false,
    });

    // 2. 部分损坏：救回合法任务并返回跳过条数提示。
    const partialStorage = createMemoryTodoStorage({
      initialRaw: JSON.stringify([
        { id: 1, text: "保住的任务", completed: true },
        { id: -1, text: "坏记录", completed: false },
      ]),
    });
    const partial = loadTodosFromStorage(partialStorage);
    expect(partial.todos).toEqual([{ id: 1, text: "保住的任务", completed: true }]);
    expect(partial.loadFailed).toBe(false);
    expect(partial.warning).toContain("1");

    // 3. 读抛错或坏 JSON：回退默认任务并标记 loadFailed。
    const failingRead = createMemoryTodoStorage({ failRead: true });
    const failed = loadTodosFromStorage(failingRead);
    expect(failed.todos).toEqual(INITIAL_TODOS.map((todo) => ({ ...todo })));
    expect(failed.loadFailed).toBe(true);
    expect(failed.warning).not.toBeNull();

    const brokenJson = createMemoryTodoStorage({ initialRaw: "{not-json" });
    const broken = loadTodosFromStorage(brokenJson);
    expect(broken.loadFailed).toBe(true);
    expect(broken.warning).not.toBeNull();
  });

  it("createLocalTodoStorage 通过 window.localStorage 读写指定键", () => {
    const storage = createLocalTodoStorage();
    expect(storage.read()).toBeNull();

    storage.write('[{"id":1,"text":"测试","completed":false}]');
    expect(window.localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe(
      '[{"id":1,"text":"测试","completed":false}]',
    );
    expect(storage.read()).toBe('[{"id":1,"text":"测试","completed":false}]');
  });
});
