import { describe, expect, it } from "vitest";
import { createTaskScheduler } from "./index.ts";

/** 把宿主的下一轮交给测试，避免依赖真实计时器的时序。 */
function setup() {
  const turns: Array<() => void> = [];
  const scheduler = createTaskScheduler((run) => turns.push(run));

  /** 仅执行宿主已经收到的一轮工作。 */
  function runTurn(): void {
    const run = turns.shift();
    if (!run) throw new Error("没有待执行的轮次");
    run();
  }

  return { scheduler, turns, runTurn };
}

describe("任务调度器", () => {
  it("安排任务时立即返回，每轮只执行一笔工作", () => {
    const { scheduler, turns, runTurn } = setup();
    const events: string[] = [];
    scheduler.schedule(() => events.push("第一笔"));
    scheduler.schedule(() => events.push("第二笔"));

    // 两笔同优先级工作不会同步执行，也不会各自占一个已经发出的轮次。
    expect(events).toEqual([]);
    expect(turns).toHaveLength(1);
    runTurn();
    expect(events).toEqual(["第一笔"]);
    runTurn();
    expect(events).toEqual(["第一笔", "第二笔"]);
    expect(turns).toHaveLength(0);
  });

  it.skip("每轮先挑高优先级任务，同一级仍按排队顺序执行", () => {
    const { scheduler, runTurn } = setup();
    const events: string[] = [];

    // 低优先级先排队，后来的交互任务仍会先被挑出来。
    scheduler.schedule(() => events.push("明细"), { priority: "idle" });
    scheduler.schedule(() => events.push("普通任务"));
    scheduler.schedule(() => events.push("第一次交互"), { priority: "user-blocking" });
    scheduler.schedule(() => events.push("第二次交互"), { priority: "user-blocking" });
    for (let turn = 0; turn < 4; turn++) runTurn();
    expect(events).toEqual(["第一次交互", "第二次交互", "普通任务", "明细"]);
  });

  it.skip("同键替换回调和优先级，旧取消函数不能删掉新的安排", () => {
    const { scheduler, turns, runTurn } = setup();
    const events: string[] = [];

    // 新安排保留这个键原本的排队位置，但带来新的回调和优先级。
    const cancelOld = scheduler.schedule(() => events.push("旧明细"), {
      key: "details",
      priority: "idle",
    });
    scheduler.schedule(() => events.push("普通任务"));
    scheduler.schedule(() => events.push("新明细"), { key: "details" });
    cancelOld();

    runTurn();
    runTurn();
    expect(events).toEqual(["新明细", "普通任务"]);
    expect(turns).toHaveLength(0);
  });

  it.skip("取消同键的最新安排后，旧任务也不会执行", () => {
    const { scheduler, turns, runTurn } = setup();
    const events: string[] = [];

    // 取消是针对正在排队的这笔任务，重复调用也安全。
    scheduler.schedule(() => events.push("旧明细"), { key: "details" });
    const cancel = scheduler.schedule(() => events.push("新明细"), { key: "details" });
    cancel();
    cancel();
    runTurn();
    expect(events).toEqual([]);
    expect(turns).toHaveLength(0);
  });

  it("回调发出后续工作再抛错时，下一轮仍然会执行", () => {
    const { scheduler, turns, runTurn } = setup();
    const events: string[] = [];
    const failure = new Error("任务失败");
    scheduler.schedule(
      () => {
        // 当前任务已经出队，可以用同一个键再安排一次。
        scheduler.schedule(() => events.push("后续工作"), { key: "details" });
        expect(turns).toHaveLength(0);
        throw failure;
      },
      { key: "details" },
    );

    expect(runTurn).toThrow(failure);
    expect(turns).toHaveLength(1);
    runTurn();
    expect(events).toEqual(["后续工作"]);
  });
});
