import { expect, it, vi } from "vitest";
import {
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  untrack,
  type Dispose,
} from "./reactive.ts";

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

it("多次读取 createMemo 直接命中缓存，不重复执行计算函数", () => {
  const [count, setCount] = createSignal(2);
  const compute = vi.fn(() => count() * 10);

  const doubled = createMemo(compute);

  expect(doubled()).toBe(20);
  expect(doubled()).toBe(20);
  expect(doubled()).toBe(20);
  expect(compute).toHaveBeenCalledTimes(1);

  setCount(3);
  expect(doubled()).toBe(30);
  expect(doubled()).toBe(30);
  expect(compute).toHaveBeenCalledTimes(2);
});

it("上游变化但派生结果按 Object.is 相同时，不唤醒下游 effect", () => {
  const [count, setCount] = createSignal(1);
  const compute = vi.fn(() => count() > 0);
  const seen: boolean[] = [];

  const isPositive = createMemo(compute);
  createEffect(() => {
    seen.push(isPositive());
  });

  expect(compute).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([true]);

  // 1 -> 2 会让 memo 重算一次，但结果仍为 true，不应再次唤醒下游 effect。
  setCount(2);
  expect(compute).toHaveBeenCalledTimes(2);
  expect(seen).toEqual([true]);

  // 2 -> 0 结果变为 false，下游 effect 才会收到通知。
  setCount(0);
  expect(compute).toHaveBeenCalledTimes(3);
  expect(seen).toEqual([true, false]);
});

it("支持链式 createMemo 组合派生，同值截断会阻断整条下游链路", () => {
  const [todos, setTodos] = createSignal([
    { id: 1, completed: true },
    { id: 2, completed: false },
  ]);
  const computeRemaining = vi.fn(() => todos().filter((item) => !item.completed).length);
  const computeSummary = vi.fn(() => `剩余 ${remaining()} 项`);
  const seen: string[] = [];

  const remaining = createMemo(computeRemaining);
  const summary = createMemo(computeSummary);
  createEffect(() => {
    seen.push(summary());
  });

  expect(seen).toEqual(["剩余 1 项"]);
  expect(computeRemaining).toHaveBeenCalledTimes(1);
  expect(computeSummary).toHaveBeenCalledTimes(1);

  // 仅调换数组顺序：remaining 重算但结果仍为 1，summary 与下游 effect 都不应重跑。
  setTodos([...todos()].reverse());
  expect(computeRemaining).toHaveBeenCalledTimes(2);
  expect(computeSummary).toHaveBeenCalledTimes(1);
  expect(seen).toEqual(["剩余 1 项"]);

  // 再新增一条未完成任务：整条链路才顺次更新。
  setTodos([...todos(), { id: 3, completed: false }]);
  expect(computeRemaining).toHaveBeenCalledTimes(3);
  expect(computeSummary).toHaveBeenCalledTimes(2);
  expect(seen).toEqual(["剩余 1 项", "剩余 2 项"]);
});

it("所属 createRoot 释放后，createMemo 自动停止响应上游变化", () => {
  const [count, setCount] = createSignal(0);
  const compute = vi.fn(() => count() * 2);

  const { memo, dispose } = createRoot((disposeRoot) => ({
    memo: createMemo(compute),
    dispose: disposeRoot,
  }));

  expect(memo()).toBe(0);
  expect(compute).toHaveBeenCalledTimes(1);

  setCount(1);
  expect(memo()).toBe(2);
  expect(compute).toHaveBeenCalledTimes(2);

  // 释放所属作用域后，memo 内部 effect 退订，上游再变也不重算，读值停留在最后缓存。
  dispose();
  setCount(2);
  expect(compute).toHaveBeenCalledTimes(2);
  expect(memo()).toBe(2);
});

it("createMemo 首次求值读值后抛错会清理半截订阅并原样重抛", () => {
  const [count, setCount] = createSignal(0);
  const compute = vi.fn(() => {
    count();
    throw new Error("memo boom");
  });

  expect(() => createMemo(compute)).toThrow("memo boom");
  expect(compute).toHaveBeenCalledTimes(1);

  setCount(1);
  expect(compute).toHaveBeenCalledTimes(1);
});

it("batch 合并多次 signal 写入，只触发一次下游 effect 且批次内立刻读到新值", () => {
  const [todos, setTodos] = createSignal(["任务 1", "任务 2", "任务 3"]);
  const [draft, setDraft] = createSignal("实现 batch");
  const seen: Array<[number, string]> = [];
  let insideBatchSnapshot: [number, string] | undefined;

  createEffect(() => {
    seen.push([todos().length, draft()]);
  });

  expect(seen).toEqual([[3, "实现 batch"]]);

  // 模拟 Todo 的 addTodo：同一操作连续更新列表和草稿，但观察者只应收到最终一致状态。
  batch(() => {
    setTodos([...todos(), draft()]);
    setDraft("");
    insideBatchSnapshot = [todos().length, draft()];
  });

  expect(insideBatchSnapshot).toEqual([4, ""]);
  expect(seen).toEqual([
    [3, "实现 batch"],
    [4, ""],
  ]);
});

it("支持嵌套 batch，仅在最外层退出时统一刷新并透传返回值", () => {
  const [first, setFirst] = createSignal(1);
  const [second, setSecond] = createSignal(10);
  const seen: number[] = [];

  createEffect(() => {
    seen.push(first() + second());
  });

  const returned = batch(() => {
    setFirst(2);
    const innerResult = batch(() => {
      setSecond(20);
      return "inner-ok";
    });
    // 内层 batch 退出时外层尚未结束，effect 仍未刷新。
    expect(seen).toEqual([11]);
    setFirst(3);
    return `${innerResult}:outer-ok`;
  });

  expect(returned).toBe("inner-ok:outer-ok");
  expect(seen).toEqual([11, 23]);
});

it("batch 回调抛错时保留已写入状态、刷新观察者并优先重抛原异常", () => {
  const [count, setCount] = createSignal(0);
  const seen: number[] = [];
  let shouldThrowInEffect = false;

  createEffect(() => {
    const current = count();
    seen.push(current);
    if (shouldThrowInEffect && current === 2) {
      throw new Error("flush boom");
    }
  });

  // 场景 1：回调写入后抛错，退出 batch 时仍刷新已提交状态并恢复后续写入能力。
  expect(() => {
    batch(() => {
      setCount(1);
      throw new Error("batch boom");
    });
  }).toThrow("batch boom");

  expect(count()).toBe(1);
  expect(seen).toEqual([0, 1]);

  // 场景 2：回调抛错且退出刷新时 effect 也抛错，优先保留原始回调异常。
  shouldThrowInEffect = true;
  expect(() => {
    batch(() => {
      setCount(2);
      throw new Error("primary callback error");
    });
  }).toThrow("primary callback error");

  expect(count()).toBe(2);
  expect(seen).toEqual([0, 1, 2]);

  // 队列与 batchDepth 已恢复，后续新注册的 effect 仍可正常响应写入。
  const afterRecovery: number[] = [];
  createEffect(() => {
    afterRecovery.push(count());
  });
  setCount(3);
  expect(afterRecovery).toEqual([2, 3]);
});

it("batch 刷新期间前序 effect 释放的排队 effect 不会被执行", () => {
  const [count, setCount] = createSignal(0);
  let secondRuns = 0;
  let disposeSecond: Dispose = () => {};

  createEffect(() => {
    if (count() === 1) {
      disposeSecond();
    }
  });

  disposeSecond = createEffect(() => {
    count();
    secondRuns += 1;
  });

  expect(secondRuns).toBe(1);

  batch(() => {
    setCount(1);
  });

  expect(secondRuns).toBe(1);
});

it("batch 刷新期间某个 effect 抛错后会清空残余队列并恢复后续更新", () => {
  const [count, setCount] = createSignal(0);
  const [other, setOther] = createSignal("a");
  const seenOther: string[] = [];

  createEffect(() => {
    if (count() === 1) {
      setOther("stale");
      throw new Error("effect failed in flush");
    }
  });

  createEffect(() => {
    seenOther.push(other());
  });

  expect(seenOther).toEqual(["a"]);

  expect(() => {
    batch(() => {
      setCount(1);
    });
  }).toThrow("effect failed in flush");

  // 异常后的下一轮写入必须照常触发刷新，不能被卡在 isFlushing === true。
  setOther("b");
  expect(seenOther).toEqual(["a", "b"]);
});

it("菱形依赖（total 先于 remaining 注册）无毛刺：新增未完成任务时 completed 只算一次且不误唤醒下游", () => {
  const [todos, setTodos] = createSignal([
    { id: 1, completed: true },
    { id: 2, completed: false },
    { id: 3, completed: false },
  ]);

  const computeTotal = vi.fn(() => todos().length);
  const computeRemaining = vi.fn(() => todos().filter((item) => !item.completed).length);
  const totalCount = createMemo(computeTotal);
  const remainingCount = createMemo(computeRemaining);
  const computeCompleted = vi.fn(() => totalCount() - remainingCount());
  const completedCount = createMemo(computeCompleted);

  const seenCompleted: number[] = [];
  createEffect(() => {
    seenCompleted.push(completedCount());
  });

  expect(seenCompleted).toEqual([1]);
  expect(computeCompleted).toHaveBeenCalledTimes(1);

  // 新增一条未完成任务：total 3->4、remaining 2->3，completed 应只重算一次得到 1，且不唤醒下游 effect。
  setTodos([...todos(), { id: 4, completed: false }]);

  expect(computeTotal).toHaveBeenCalledTimes(2);
  expect(computeRemaining).toHaveBeenCalledTimes(2);
  expect(computeCompleted).toHaveBeenCalledTimes(2);
  expect(completedCount()).toBe(1);
  expect(seenCompleted).toEqual([1]);

  // 新增一条已完成任务：completed 变为 2，下游只收到一次最终值 2。
  setTodos([...todos(), { id: 5, completed: true }]);
  expect(computeCompleted).toHaveBeenCalledTimes(3);
  expect(seenCompleted).toEqual([1, 2]);
});

it("菱形依赖（remaining 先于 total 注册）同样无毛刺且不依赖注册顺序", () => {
  const [todos, setTodos] = createSignal([
    { id: 1, completed: true },
    { id: 2, completed: false },
  ]);

  const remainingCount = createMemo(() => todos().filter((item) => !item.completed).length);
  const totalCount = createMemo(() => todos().length);
  const computeCompleted = vi.fn(() => totalCount() - remainingCount());
  const completedCount = createMemo(computeCompleted);

  const seenCompleted: number[] = [];
  createEffect(() => {
    seenCompleted.push(completedCount());
  });

  expect(seenCompleted).toEqual([1]);

  setTodos([...todos(), { id: 3, completed: false }]);

  expect(computeCompleted).toHaveBeenCalledTimes(2);
  expect(seenCompleted).toEqual([1]);
});

it("同一个 effect 同时读取源 signal 和派生 memo 时，单次写入只重跑一次且看到一致快照", () => {
  const [count, setCount] = createSignal(2);
  const doubled = createMemo(() => count() * 2);
  const seen: Array<[number, number]> = [];

  createEffect(() => {
    seen.push([count(), doubled()]);
  });

  expect(seen).toEqual([[2, 4]]);

  setCount(5);
  expect(seen).toEqual([
    [2, 4],
    [5, 10],
  ]);
});

it("在 batch 中途读取 createMemo 会按需刷新到最新一致值，同时下游 effect 仍等到 batch 结束", () => {
  const [count, setCount] = createSignal(2);
  const computeDoubled = vi.fn(() => count() * 2);
  const doubled = createMemo(computeDoubled);
  const seen: number[] = [];

  createEffect(() => {
    seen.push(doubled());
  });

  expect(seen).toEqual([4]);
  expect(computeDoubled).toHaveBeenCalledTimes(1);

  let midBatchValue = -1;
  batch(() => {
    setCount(10);
    // 批次内显式读取 memo 立即按需拉取最新值 20，但下游 effect 仍暂缓执行。
    midBatchValue = doubled();
    expect(seen).toEqual([4]);
  });

  expect(midBatchValue).toBe(20);
  // 退出 batch 后不再重复计算已干净的 doubled，下游 effect 只运行一次。
  expect(computeDoubled).toHaveBeenCalledTimes(2);
  expect(seen).toEqual([4, 20]);
});

it("batch 同时关闭分支并置空数据时，先跑外层 effect 释放死分支，不误跑已退出的孤儿 memo", () => {
  const [show, setShow] = createSignal(true);
  const [user, setUser] = createSignal<{ name: string } | null>({ name: "Ada" });
  const seenNames: string[] = [];
  const computeName = vi.fn(() => {
    const current = user();
    if (!current) {
      throw new Error("orphan memo should not run after branch disposed");
    }
    return current.name;
  });

  let disposeBranch: Dispose | undefined;
  createEffect(() => {
    if (show()) {
      createRoot((dispose) => {
        disposeBranch = dispose;
        const userName = createMemo(computeName);
        createEffect(() => {
          seenNames.push(userName());
        });
      });
    } else {
      disposeBranch?.();
      disposeBranch = undefined;
    }
  });

  expect(seenNames).toEqual(["Ada"]);
  expect(computeName).toHaveBeenCalledTimes(1);

  // 同时隐藏分支并把 user 置空：外层 effect 先释放子分支里的 memo，避免崩溃。
  expect(() => {
    batch(() => {
      setShow(false);
      setUser(null);
    });
  }).not.toThrow();

  expect(computeName).toHaveBeenCalledTimes(1);
});

it("untrack 暂时屏蔽依赖追踪但保留当前 Owner，内部仍可读到最新值并随父作用域释放", () => {
  const [tracked, setTracked] = createSignal(1);
  const [ignored, setIgnored] = createSignal(10);
  const seen: Array<[number, number]> = [];
  const cleanup = vi.fn();

  const dispose = createEffect(() => {
    const a = tracked();
    const b = untrack(() => {
      // untrack 只关闭追踪，不切断 Owner：内部登记的 onCleanup 仍归属于当前 effect。
      onCleanup(cleanup);
      return ignored();
    });
    seen.push([a, b]);
  });

  expect(seen).toEqual([[1, 10]]);
  expect(cleanup).toHaveBeenCalledTimes(0);

  // 修改仅在 untrack 内读取的 ignored，不应触发外层 effect 重跑。
  setIgnored(20);
  expect(seen).toEqual([[1, 10]]);

  // 修改被追踪的 tracked 时，会触发上一轮清理并在 untrack 内读到最新的 ignored 值 20。
  setTracked(2);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([
    [1, 10],
    [2, 20],
  ]);

  dispose();
  expect(cleanup).toHaveBeenCalledTimes(2);
});

it.skip("effect 首次执行或重跑时写回自身依赖不会递归重入，而是按顺序排队收敛并正确成对清理", () => {
  const [count, setCount] = createSignal(0);
  const events: string[] = [];

  const dispose = createEffect(() => {
    const current = count();
    events.push(`start:${current}`);
    onCleanup(() => {
      events.push(`cleanup:${current}`);
    });
    if (current < 2) {
      setCount(current + 1);
    }
    events.push(`end:${current}`);
  });

  // 每一轮必须完整跑完 start -> end，再执行上一轮 cleanup 进入下一轮，绝不嵌套交错。
  expect(events).toEqual([
    "start:0",
    "end:0",
    "cleanup:0",
    "start:1",
    "end:1",
    "cleanup:1",
    "start:2",
    "end:2",
  ]);
  expect(count()).toBe(2);

  dispose();
  expect(events.at(-1)).toBe("cleanup:2");
});

it.skip("在运行中的 effect 内部调用 batch 写回不会打断当前执行，而是等外层 effect 结束后再统一刷新", () => {
  const [step, setStep] = createSignal(0);
  const [label, setLabel] = createSignal("init");
  const order: string[] = [];

  createEffect(() => {
    const current = step();
    order.push(`writer:start:${current}`);
    if (current === 0) {
      batch(() => {
        setStep(1);
        setLabel("done");
      });
    }
    order.push(`writer:end:${current}`);
  });

  createEffect(() => {
    order.push(`reader:${step()}:${label()}`);
  });

  // writer 首次执行内调用 batch 后，先完成 writer:end:0，再轮到 writer:start:1 -> writer:end:1。
  expect(order).toEqual([
    "writer:start:0",
    "writer:end:0",
    "writer:start:1",
    "writer:end:1",
    "reader:1:done",
  ]);
});

it.skip("超过 100 个独立计算在同一轮更新中执行不会误触 MAX_UPDATES 熔断", () => {
  const [version, setVersion] = createSignal(0);
  let totalRuns = 0;

  for (let i = 0; i < 120; i += 1) {
    createEffect(() => {
      version();
      totalRuns += 1;
    });
  }

  expect(totalRuns).toBe(120);

  // 单轮同时唤醒 120 个彼此独立的 effect，每个只跑 1 次，不应触发死循环熔断。
  expect(() => setVersion(1)).not.toThrow();
  expect(totalRuns).toBe(240);
});

it.skip("无限自写回的 effect 会在达到 MAX_UPDATES 时熔断抛错，并恢复调度器供后续更新使用", () => {
  const [loop, setLoop] = createSignal(0);
  const [healthy, setHealthy] = createSignal("a");
  const seenHealthy: string[] = [];

  createEffect(() => {
    const current = loop();
    if (current > 0) {
      setLoop(current + 1);
    }
  });

  createEffect(() => {
    seenHealthy.push(healthy());
  });

  expect(() => setLoop(1)).toThrow("Maximum reactive update depth exceeded");

  // 熔断后队列与 isFlushing 必须已恢复，其他无关状态的写入照常生效。
  setHealthy("b");
  expect(seenHealthy).toEqual(["a", "b"]);
});

it.skip("两个 effect 互相写回形成乒乓死循环时同样会触发熔断并恢复后续更新", () => {
  const [left, setLeft] = createSignal(0);
  const [right, setRight] = createSignal(0);
  const [healthy, setHealthy] = createSignal(0);
  const seenHealthy: number[] = [];

  createEffect(() => {
    const current = left();
    if (current > 0) {
      setRight(current + 1);
    }
  });

  createEffect(() => {
    const current = right();
    if (current > 0) {
      setLeft(current + 1);
    }
  });

  createEffect(() => {
    seenHealthy.push(healthy());
  });

  expect(() => setLeft(1)).toThrow("Maximum reactive update depth exceeded");

  setHealthy(42);
  expect(seenHealthy).toEqual([0, 42]);
});

it.skip("自引用或相互引用的循环 createMemo 会立即抛出循环依赖错误并清理半截订阅", () => {
  const [flag, setFlag] = createSignal(false);
  const [healthy, setHealthy] = createSignal("ok");
  const seenHealthy: string[] = [];
  const cleanupA = vi.fn();

  // 场景 1：重跑时切入自引用环（selfMemo -> selfMemo）。
  const [selfCycle, setSelfCycle] = createSignal(false);
  let selfMemo!: () => number;
  selfMemo = createMemo(() => (selfCycle() ? selfMemo() + 1 : 0));
  expect(selfMemo()).toBe(0);
  expect(() => setSelfCycle(true)).toThrow("Circular memo dependency detected");

  // 场景 2：动态切入相互引用环（a -> b -> a）。
  let memoB!: () => number;
  const memoA = createMemo(() => {
    onCleanup(cleanupA);
    return flag() ? memoB() + 1 : 1;
  });
  memoB = createMemo(() => (flag() ? memoA() + 1 : 2));

  createEffect(() => {
    seenHealthy.push(healthy());
  });

  expect(memoA()).toBe(1);
  expect(memoB()).toBe(2);

  expect(() => setFlag(true)).toThrow("Circular memo dependency detected");
  // 重跑前先清理第 1 轮的 cleanupA，抛错回滚再清理第 2 轮半途登记的 cleanupA，共 2 次。
  expect(cleanupA).toHaveBeenCalledTimes(2);

  // 报错后调度器状态已恢复，其他更新照常运行。
  setHealthy("recovered");
  expect(seenHealthy).toEqual(["ok", "recovered"]);
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

it("untrack 屏蔽读取追踪，写入等当前 effect 结束再刷新", () => {
  const [count, setCount] = createSignal(0);
  const [ignored, setIgnored] = createSignal(0);
  const seen: number[] = [];

  // 把这一轮读到的值留到回调末尾再记录，检测有无提前重入。
  const dispose = createEffect(() => {
    const value = count();
    untrack(() => {
      ignored();
      if (value === 0) setCount(1);
    });
    seen.push(value);
  });

  setIgnored(1);
  expect(seen).toEqual([0, 1]);
  dispose();
});
