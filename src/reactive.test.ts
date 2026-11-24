import { expect, it } from "vitest";
import { createEffect, createSignal } from "./reactive.ts";

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

it("effect 自动订阅它读取的 signal", () => {
  const [count, setCount] = createSignal(0);
  const seen: number[] = [];

  createEffect(() => {
    seen.push(count());
  });
  setCount(1);
  setCount(2);
  // 0 来自首次执行，1 和 2 来自后续两次写入触发的重跑。
  expect(seen).toEqual([0, 1, 2]);
});

it("一次写入通知多个 effect", () => {
  const [count, setCount] = createSignal(0);
  const first: number[] = [];
  const second: number[] = [];

  createEffect(() => {
    first.push(count());
  });
  createEffect(() => {
    second.push(count());
  });

  setCount(1);
  expect(first).toEqual([0, 1]);
  expect(second).toEqual([0, 1]);
});

it("一个 effect 自动追踪多个 signal", () => {
  const [price, setPrice] = createSignal(10);
  const [quantity, setQuantity] = createSignal(2);
  const totals: number[] = [];

  createEffect(() => {
    totals.push(price() * quantity());
  });

  setPrice(15);
  setQuantity(3);
  expect(totals).toEqual([20, 30, 45]);
});

it("effect 抛错后仍会恢复追踪上下文", () => {
  const [count, setCount] = createSignal(0);
  let runs = 0;

  // 若未在 finally 中恢复 currentEffect，下面普通的 count() 会把已抛错退出的 effect 误登记为订阅者。
  expect(() => {
    createEffect(() => {
      runs += 1;
      throw new Error("boom");
    });
  }).toThrow("boom");

  expect(runs).toBe(1);
  expect(count()).toBe(0);

  setCount(1);
  expect(runs).toBe(1);
});

it("嵌套 effect 退出后会恢复外层追踪上下文", () => {
  const [inner] = createSignal(0);
  const [outer, setOuter] = createSignal(0);
  const outerSeen: number[] = [];

  createEffect(() => {
    // 内层 effect 结束后应恢复外层 currentEffect，而不是清空为 undefined。
    createEffect(() => {
      inner();
    });
    // 这次读取发生在内层退出之后，必须继续登记到外层 effect 上。
    outerSeen.push(outer());
  });

  setOuter(1);
  expect(outerSeen).toEqual([0, 1]);
});

it("写入相同值时不会重复触发 effect", () => {
  const [count, setCount] = createSignal(0);
  let runs = 0;

  createEffect(() => {
    count();
    runs += 1;
  });

  setCount(0);
  setCount(0);
  expect(runs).toBe(1);

  setCount(1);
  expect(runs).toBe(2);
});

it("重复写入 NaN 时也会跳过通知", () => {
  const [value, setValue] = createSignal(Number.NaN);
  let runs = 0;

  createEffect(() => {
    value();
    runs += 1;
  });

  // === 会把 NaN === NaN 判成 false，只有 Object.is 才能识别出值没有变化。
  setValue(Number.NaN);
  expect(runs).toBe(1);
});

it("写入 -0 替换 +0 时会视为新值", () => {
  const [zero, setZero] = createSignal(0);
  let runs = 0;

  createEffect(() => {
    zero();
    runs += 1;
  });

  // Object.is(+0, -0) 为 false，因此从 +0 改为 -0 会触发一次更新。
  setZero(-0);
  expect(runs).toBe(2);
});
