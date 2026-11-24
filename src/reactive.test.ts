import { expect, it } from "vitest";
import { createSignal } from "./reactive.ts";

it("创建后 getter 返回初始值", () => {
  const [count] = createSignal(0);
  expect(count()).toBe(0);
});

it("写入新值后 getter 返回新值", () => {
  const [count, setCount] = createSignal(0);
  const [other] = createSignal(10);

  expect(count()).toBe(0);
  // 写入后用同一个 getter 再次读取，确认读到更新过的闭包状态。
  setCount(1);
  expect(count()).toBe(1);
  // 另一个 signal 有自己独立的闭包，不受这次写入影响。
  expect(other()).toBe(10);
});

it("订阅者在写入后读到更新值", () => {
  const [count, setCount, subscribe] = createSignal(0);
  const seen: number[] = [];

  subscribe(() => seen.push(count()));
  // 登记本身不会立刻触发回调。
  expect(seen).toEqual([]);

  setCount(1);
  setCount(2);
  // 必须先写值再通知，回调才能依次读到 1 和 2；顺序反了会读到 0 和 1。
  expect(seen).toEqual([1, 2]);
});

it("一次写入通知多个订阅者", () => {
  const [count, setCount, subscribe] = createSignal(0);
  const first: number[] = [];
  const second: number[] = [];

  subscribe(() => first.push(count()));
  subscribe(() => second.push(count()));

  setCount(1);
  expect(first).toEqual([1]);
  expect(second).toEqual([1]);
});
