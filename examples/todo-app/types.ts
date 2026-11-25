/** 筛选条件枚举：全部、未完成或已完成。 */
export type TodoFilter = "all" | "active" | "completed";

/** 单条待办任务数据结构。 */
export type Todo = {
  id: number;
  text: string;
  completed: boolean;
};

/** 初始示例待办任务：仅在本地存储键不存在或读取失败回退时使用。 */
export const INITIAL_TODOS: readonly Todo[] = [
  { id: 1, text: "实现 createMemo 派生缓存", completed: true },
  { id: 2, text: "实现按 key 复用的 For 列表", completed: false },
  { id: 3, text: "补齐表单输入与行内编辑", completed: false },
];
