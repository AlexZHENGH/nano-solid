import { expect, it, vi } from "vitest";
import { createEffect, createRoot, createSignal, onCleanup, type Dispose } from "./reactive.ts";

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

it("切换分支后不再响应旧分支的写入", () => {
  const [isLeft, setIsLeft] = createSignal(true);
  const [left, setLeft] = createSignal(0);
  const [right, setRight] = createSignal(10);
  const seen: number[] = [];

  createEffect(() => {
    seen.push(isLeft() ? left() : right());
  });

  // 切到右侧分支后，再修改旧的 left 不应该再次唤醒 effect。
  setIsLeft(false);
  setLeft(1);
  setRight(11);

  expect(seen).toEqual([0, 10, 11]);
});

it("切回原分支后会重新追踪原分支并放弃另一侧", () => {
  const [isLeft, setIsLeft] = createSignal(true);
  const [left, setLeft] = createSignal(0);
  const [right, setRight] = createSignal(10);
  const seen: number[] = [];

  createEffect(() => {
    seen.push(isLeft() ? left() : right());
  });

  setIsLeft(false);
  setIsLeft(true);
  // 已经切回左侧分支，修改 right 不应再触发重跑，修改 left 应恢复触发。
  setRight(12);
  setLeft(2);

  expect(seen).toEqual([0, 10, 0, 2]);
});

it("调用 dispose 后不再响应后续写入，且重复调用安全", () => {
  const [count, setCount] = createSignal(0);
  const seen: number[] = [];

  const dispose = createEffect(() => {
    seen.push(count());
  });

  setCount(1);
  dispose();
  // 重复释放应保持幂等，不抛错也不影响 signal 自身读写。
  dispose();
  setCount(2);

  expect(count()).toBe(2);
  expect(seen).toEqual([0, 1]);
});

it("同一轮通知中前一个 effect 释放后一个 effect 时会跳过执行", () => {
  const [count, setCount] = createSignal(0);
  let secondRuns = 0;
  let disposeSecond: Dispose | undefined;

  createEffect(() => {
    if (count() > 0) {
      // 同一轮 setCount(1) 快照里后一个 effect 已经排队，但这里提前释放了它。
      disposeSecond?.();
    }
  });

  disposeSecond = createEffect(() => {
    count();
    secondRuns += 1;
  });

  expect(secondRuns).toBe(1);
  setCount(1);
  expect(secondRuns).toBe(1);
});

it("effect 在回调中释放自己后不再响应后续写入", () => {
  const [count, setCount] = createSignal(0);
  const [other, setOther] = createSignal(0);
  let runs = 0;

  const dispose = createEffect(() => {
    runs += 1;
    if (count() >= 1) {
      dispose();
      // 即使自释放后继续读值，也不应重新建立订阅或再次唤醒。
      other();
    }
  });

  setCount(1);
  setOther(1);
  setCount(2);

  expect(runs).toBe(2);
});

it("首次执行读值后抛错会清理半截订阅并继续抛出异常", () => {
  const [count, setCount] = createSignal(0);
  let runs = 0;

  // 先读 count() 建立订阅再抛错，调用方拿不到 dispose 句柄，必须由框架自动释放。
  expect(() => {
    createEffect(() => {
      runs += 1;
      count();
      throw new Error("boom");
    });
  }).toThrow("boom");

  expect(runs).toBe(1);
  // 后续写入不应再唤醒已经失败的 effect，也不应再次抛错。
  setCount(1);
  expect(runs).toBe(1);
});

it("重跑中途读值后抛错会释放该 effect 且不再响应后续写入", () => {
  const [count, setCount] = createSignal(0);
  let runs = 0;

  createEffect(() => {
    runs += 1;
    if (count() === 1) {
      throw new Error("boom");
    }
  });

  expect(runs).toBe(1);
  expect(() => setCount(1)).toThrow("boom");
  expect(runs).toBe(2);

  // 抛错前读到的 count() 已在 catch 中清理，再次更新不会继续触发。
  setCount(2);
  expect(runs).toBe(2);
});

it("内层 effect 抛错释放自己时不会影响外层 effect 继续追踪", () => {
  const [inner, setInner] = createSignal(0);
  const [outer, setOuter] = createSignal(0);
  let innerRuns = 0;
  const outerSeen: number[] = [];

  createEffect(() => {
    try {
      createEffect(() => {
        innerRuns += 1;
        inner();
        throw new Error("inner boom");
      });
    } catch {
      // 外层接住内层抛出的异常后继续读取自己的依赖。
    }
    outerSeen.push(outer());
  });

  expect(innerRuns).toBe(1);
  // 内层已自动释放，改 inner 不会再次触发内层或抛错。
  setInner(1);
  expect(innerRuns).toBe(1);

  // 外层上下文已在 finally 中恢复，改 outer 仍会正常重跑。
  setOuter(1);
  expect(outerSeen).toEqual([0, 1]);
});

it("外层 effect 重跑前会清理上一轮创建的内层 effect", () => {
  const [outer, setOuter] = createSignal(0);
  const [inner, setInner] = createSignal(0);
  const logs: string[] = [];

  createEffect(() => {
    const step = outer();
    createEffect(() => {
      logs.push(`${step}:${inner()}`);
    });
  });

  expect(logs).toEqual(["0:0"]);

  // 外层重跑两次后，旧两轮创建的内层 effect 必须已经释放，改 inner 只会唤醒最新一轮。
  setOuter(1);
  setOuter(2);
  logs.length = 0;

  setInner(1);
  expect(logs).toEqual(["2:1"]);
});

it("释放外层 effect 时会递归释放多层嵌套的后代 effect", () => {
  const [outer, setOuter] = createSignal(0);
  const [middle, setMiddle] = createSignal(0);
  const [inner, setInner] = createSignal(0);
  let outerRuns = 0;
  let middleRuns = 0;
  let innerRuns = 0;

  const disposeOuter = createEffect(() => {
    outer();
    outerRuns += 1;
    createEffect(() => {
      middle();
      middleRuns += 1;
      createEffect(() => {
        inner();
        innerRuns += 1;
      });
    });
  });

  expect([outerRuns, middleRuns, innerRuns]).toEqual([1, 1, 1]);

  // 释放最外层后，三层节点应全部退订，改任意一层的 signal 都不会再触发执行。
  disposeOuter();
  setOuter(1);
  setMiddle(1);
  setInner(1);
  expect([outerRuns, middleRuns, innerRuns]).toEqual([1, 1, 1]);
});

it("内层 effect 抛错被接住后仍会恢复外层所有权上下文", () => {
  const [outer, setOuter] = createSignal(0);
  const [inner, setInner] = createSignal(0);
  const seen: string[] = [];

  const disposeOuter = createEffect(() => {
    const step = outer();
    try {
      createEffect(() => {
        throw new Error("inner boom");
      });
    } catch {
      // 外层接住异常后继续创建另一个内层 effect，它仍应归属于外层。
    }
    createEffect(() => {
      seen.push(`${step}:${inner()}`);
    });
  });

  expect(seen).toEqual(["0:0"]);

  setOuter(1);
  seen.length = 0;
  setInner(1);
  expect(seen).toEqual(["1:1"]);

  disposeOuter();
  setInner(2);
  expect(seen).toEqual(["1:1"]);
});

it("外层 effect 创建内层 effect 后中途抛错时也会清理已创建的内层 effect", () => {
  const [inner, setInner] = createSignal(0);
  let innerRuns = 0;

  expect(() => {
    createEffect(() => {
      createEffect(() => {
        inner();
        innerRuns += 1;
      });
      throw new Error("outer boom");
    });
  }).toThrow("outer boom");

  expect(innerRuns).toBe(1);
  // 外层在 catch 中释放自己时，已挂入 children 的内层 effect 也必须一并清理。
  setInner(1);
  expect(innerRuns).toBe(1);
});

it("createRoot 统一回收其内部创建的 effect 与 onCleanup，且释放幂等", () => {
  const [count, setCount] = createSignal(0);
  const seen: number[] = [];
  const cleanup = vi.fn();

  const dispose = createRoot((disposeRoot) => {
    createEffect(() => {
      seen.push(count());
    });
    onCleanup(cleanup);
    return disposeRoot;
  });

  setCount(1);
  expect(seen).toEqual([0, 1]);
  expect(cleanup).toHaveBeenCalledTimes(0);

  // 调用一次 dispose 释放全部资源，重复调用保持幂等。
  dispose();
  dispose();
  setCount(2);

  expect(seen).toEqual([0, 1]);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("onCleanup 在同作用域内按后进先出顺序执行，无 Owner 时静默忽略", () => {
  const order: string[] = [];

  // 不在任何 root 或 effect 内调用 onCleanup 时不应报错。
  expect(() => onCleanup(() => order.push("orphan"))).not.toThrow();

  const dispose = createRoot((disposeRoot) => {
    onCleanup(() => order.push("first"));
    onCleanup(() => order.push("second"));
    onCleanup(() => order.push("third"));
    return disposeRoot;
  });

  dispose();
  expect(order).toEqual(["third", "second", "first"]);
});

it("createEffect 内的 onCleanup 会在每次重跑前和最终释放时自动执行", () => {
  const [count, setCount] = createSignal(0);
  const events: string[] = [];

  const dispose = createEffect(() => {
    const current = count();
    events.push(`run:${current}`);
    onCleanup(() => {
      events.push(`cleanup:${current}`);
    });
  });

  setCount(1);
  setCount(2);
  dispose();

  expect(events).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1", "run:2", "cleanup:2"]);
});

it("createRoot 隔离外层依赖追踪与所有权，退出后恢复外层上下文", () => {
  const [outer, setOuter] = createSignal(0);
  const [inside, setInside] = createSignal(0);
  const [after, setAfter] = createSignal(0);
  let outerRuns = 0;
  let rootDisposed = 0;
  let disposeDetached: Dispose | undefined;

  const disposeOuter = createEffect(() => {
    outer();
    outerRuns += 1;

    if (!disposeDetached) {
      disposeDetached = createRoot((disposeRoot) => {
        // createRoot 内的普通读值不应成为外层 effect 的依赖。
        inside();
        onCleanup(() => {
          rootDisposed += 1;
        });
        return disposeRoot;
      });
    }

    // 退出 createRoot 后必须恢复外层追踪上下文。
    after();
  });

  expect(outerRuns).toBe(1);

  // 修改仅在 createRoot 内读过的 inside，不应唤醒外层 effect。
  setInside(1);
  expect(outerRuns).toBe(1);

  // 重跑与释放外层 effect 时，独立的 createRoot 不会被误杀。
  setOuter(1);
  setAfter(1);
  expect(outerRuns).toBe(3);
  expect(rootDisposed).toBe(0);

  disposeOuter();
  expect(rootDisposed).toBe(0);

  disposeDetached?.();
  expect(rootDisposed).toBe(1);
});

it("createRoot 的 setup 中途抛错时会先清理已建资源再原样重抛", () => {
  const [count, setCount] = createSignal(0);
  let runs = 0;
  const order: string[] = [];

  expect(() => {
    createRoot(() => {
      onCleanup(() => order.push("cleanup-1"));
      createEffect(() => {
        count();
        runs += 1;
        onCleanup(() => order.push("effect-cleanup"));
      });
      onCleanup(() => order.push("cleanup-2"));
      throw new Error("setup failed");
    });
  }).toThrow("setup failed");

  expect(runs).toBe(1);
  // 子 effect 先于父作用域的 LIFO 清理回调被释放，后续写入不再唤醒它。
  expect(order).toEqual(["effect-cleanup", "cleanup-2", "cleanup-1"]);
  setCount(1);
  expect(runs).toBe(1);
});

it("onCleanup 回调在非追踪环境下执行，不会误把读值登记为外层依赖", () => {
  const [trigger, setTrigger] = createSignal(0);
  const [secret, setSecret] = createSignal(0);
  let outerRuns = 0;

  createEffect(() => {
    const current = trigger();
    outerRuns += 1;
    onCleanup(() => {
      // 清理阶段读到 secret() 时不应把它变成外层 effect 的依赖。
      secret();
    });
    if (current > 10) return;
  });

  expect(outerRuns).toBe(1);
  setTrigger(1);
  expect(outerRuns).toBe(2);

  // 上一轮清理时读过 secret()，但修改 secret 不应触发重跑。
  setSecret(1);
  expect(outerRuns).toBe(2);
});

it("清理回调抛错时仍释放兄弟 effect 和父作用域", () => {
  const [count, setCount] = createSignal(0);
  const observed = vi.fn();
  const cleanups: string[] = [];
  const failure = new Error("清理失败");

  // 故意让后创建的 effect 先释放并抛错，检查其余回调与兄弟 effect 仍会清理。
  const dispose = createRoot((dispose) => {
    onCleanup(() => cleanups.push("父作用域"));
    createEffect(() => observed(count()));
    createEffect(() => {
      onCleanup(() => cleanups.push("其余回调"));
      onCleanup(() => {
        throw failure;
      });
    });
    return dispose;
  });

  expect(dispose).toThrow(failure);
  dispose();
  setCount(1);
  expect(cleanups).toEqual(["其余回调", "父作用域"]);
  expect(observed.mock.calls).toEqual([[0]]);
});

it("初始化失败时完成回滚并重抛原始异常", () => {
  const failure = new Error("初始化失败");
  const cleanup = vi.fn();

  // 两种入口的回滚都会遇到清理异常，应留下初次失败的原因。
  for (const setup of [createRoot, createEffect]) {
    expect(() =>
      setup(() => {
        onCleanup(cleanup);
        onCleanup(() => {
          throw new Error("清理失败");
        });
        throw failure;
      }),
    ).toThrow(failure);
  }

  expect(cleanup).toHaveBeenCalledTimes(2);
});
