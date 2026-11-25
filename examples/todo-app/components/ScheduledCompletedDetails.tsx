import { createEffect, createSignal, onCleanup, type TaskScheduler } from "nano-solid";
import type { Todo } from "../types.ts";

/** 任务列表用来追踪变化，明细的计算等到调度器执行时再做。 */
export type ScheduledCompletedDetailsProps = {
  /** 读取当前全部任务，作为更新明细的依据。 */
  todos: () => readonly Todo[];
  /** 从最新列表整理已完成任务的说明。 */
  calculate: () => string;
  /** 由调用者决定把明细放进哪个队列。 */
  scheduler: TaskScheduler;
};

/**
 * 展示可以稍后计算的已完成明细。关闭明细后释放尚未运行的任务。
 * @param props 任务来源、惰性计算和调度器。
 * @returns 显示明细或等待状态的段落。
 */
export function ScheduledCompletedDetails(props: ScheduledCompletedDetailsProps): Node {
  // 每次打开明细都有自己的键，合并同一面板的更新时也不会取消别的实例。
  const key = Symbol("completed-details");
  const [message, setMessage] = createSignal("正在整理明细…");
  let cancel: (() => void) | undefined;
  let disposed = false;

  createEffect(() => {
    // 这里只登记任务列表的依赖。惰性明细留到排到这笔工作时才读取。
    props.todos();
    setMessage("正在整理明细…");
    cancel = props.scheduler.schedule(
      () => {
        if (!disposed) setMessage(props.calculate());
      },
      { key, priority: "idle" },
    );
  });

  // 关闭明细或整个 Todo 页面时，等待中的工作可以取消。
  onCleanup(() => {
    disposed = true;
    cancel?.();
  });

  return (
    <p id="completed-details" class="ns-meta">
      {message}
    </p>
  );
}
