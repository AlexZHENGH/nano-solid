/** 调度器只在尚未开始的任务之间选择优先级。 */
export type TaskPriority = "user-blocking" | "normal" | "idle";

/** 用来合并等待中工作的键。文案等共享用途可以用字符串，组件可以用独立的 Symbol。 */
export type TaskKey = string | symbol;

/** 排队时可指定优先级，也可以给同一类工作一个共同的键。 */
export type TaskOptions = {
  priority?: TaskPriority;
  key?: TaskKey;
};

/** 一个支持取消的任务队列，回调在以后的轮次开始。 */
export type TaskScheduler = {
  /** 安排任务，返回取消这一次安排的函数。 */
  schedule(callback: () => void, options?: TaskOptions): () => void;
};

/** 将还没有开始的任务与排序信息放在一起。 */
type Task = { callback: () => void; priority: TaskPriority };

/** 数字越小，表示等待中的任务应该越早执行。 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
const priorities: Record<TaskPriority, number> = { "user-blocking": 0, normal: 1, idle: 2 };

/**
 * 创建可主动安排任务的队列，每轮最多执行一个同步回调。
 * @param requestTurn 安排下一轮的函数，需要在当前调用返回后执行传入的回调。
 * @returns 可以安排或取消等待中任务的调度器。
 */
export function createTaskScheduler(
  requestTurn: (run: () => void) => void = (run) => setTimeout(run, 0),
): TaskScheduler {
  // Map 保留任务排队的顺序。已经安排一轮时，后续任务只需要进队。
  const pending = new Map<TaskKey, Task>();
  let turnRequested = false;

  /** 从仍在等待的任务中选一笔，优先级相同则保留进入队列的顺序。 */
  function pickTask(): [TaskKey, Task] | undefined {
    // 每轮开始才挑任务，这样上一轮等待时新到的高优先级任务也能参与选择。
    // TODO: 按 priorities 找到优先级最高的任务。
    return pending.entries().next().value;
  }

  /** 队列有任务且还没有安排下一轮时，交给宿主安排一次执行。 */
  function queueTurn(): void {
    if (turnRequested || pending.size === 0) return;
    turnRequested = true;
    requestTurn(() => {
      try {
        const entry = pickTask();
        if (!entry) return;
        const [key, task] = entry;
        // 回调可能用相同的键安排后续工作，先拿走本轮任务，再运行它。
        pending.delete(key);
        task.callback();
      } finally {
        // 给下一轮留出机会。即使当前回调抛错，别的任务仍然可以继续。
        turnRequested = false;
        queueTurn();
      }
    });
  }

  return {
    schedule(callback, options = {}) {
      // 使用同一个键时，新的安排应该替换还没执行的旧工作。
      // TODO: 提供 key 时用它关联同一类任务。
      const key = Symbol();
      const task = { callback, priority: options.priority ?? "normal" };
      pending.set(key, task);
      queueTurn();

      // 取消函数属于这一次安排，不能取消后来用同一键替换进去的任务。
      // TODO: 删除前检查队列里的对象是否仍是这次安排。
      return () => {
        pending.delete(key);
      };
    },
  };
}
