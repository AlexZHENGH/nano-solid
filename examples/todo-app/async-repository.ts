import type { Todo } from "./types.ts";

/** 异步仓库以整份列表为读写单位，调用方可以在卸载时请求取消。 */
export type AsyncTodoRepository = {
  /** 读取一份独立快照，返回后由应用持有。 */
  load(signal: AbortSignal): Promise<readonly Todo[]>;
  /** 保存发出时的列表，Promise 成功完成表示这份快照已被仓库确认。 */
  save(snapshot: readonly Todo[], signal: AbortSignal): Promise<void>;
};
