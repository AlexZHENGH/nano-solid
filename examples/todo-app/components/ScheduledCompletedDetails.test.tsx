// @vitest-environment jsdom
import { createSignal, createTaskScheduler, render } from "nano-solid";
import { describe, expect, it, vi } from "vitest";
import type { Todo } from "../types.ts";
import { ScheduledCompletedDetails } from "./ScheduledCompletedDetails.tsx";

/** 托管一份实际明细视图。测试可以主动执行计时轮次，并检查真正发生了几次计算。 */
function mountDetails() {
  const turns: Array<() => void> = [];
  const scheduler = createTaskScheduler((run) => turns.push(run));
  const container = document.createElement("div");
  const [todos, setTodos] = createSignal<readonly Todo[]>([]);
  const calculate = vi.fn(() =>
    todos()
      .filter((todo) => todo.completed)
      .map((todo) => todo.text)
      .join("、"),
  );
  const dispose = render(
    () => <ScheduledCompletedDetails todos={todos} calculate={calculate} scheduler={scheduler} />,
    container,
  );
  return { turns, container, setTodos, calculate, dispose };
}

describe("Todo 已完成明细的延后计算", () => {
  it("连续修改先只排队，轮到明细时计算一次最新列表", () => {
    const { turns, container, setTodos, calculate, dispose } = mountDetails();
    try {
      // 初次展开和接下来的两次编辑用同一个任务键，明细还没开始计算。
      setTodos([{ id: 1, text: "订会议室", completed: true }]);
      setTodos([
        { id: 1, text: "订会议室", completed: true },
        { id: 2, text: "发出议程", completed: true },
      ]);
      expect(calculate).not.toHaveBeenCalled();
      expect(container.textContent).toBe("正在整理明细…");

      turns.shift()?.();
      expect(container.textContent).toBe("订会议室、发出议程");
      expect(calculate).toHaveBeenCalledTimes(1);
      expect(turns).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it("卸载明细时取消等待中的计算", () => {
    const { turns, container, calculate, dispose } = mountDetails();
    // 宿主的执行机会已经安排。关闭视图后，就算推进到那一轮也没有明细工作可做。
    expect(turns).toHaveLength(1);
    dispose();
    turns.shift()?.();
    expect(calculate).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
