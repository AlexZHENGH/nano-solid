import { INITIAL_TODOS, type Todo } from "./types.ts";

/** 浏览器 localStorage 中保存 Todo 列表使用的默认键名。 */
export const DEFAULT_STORAGE_KEY = "nano-solid:todos";

/**
 * 同步字符串存储槽接口：隔离浏览器 localStorage 与测试用的内存 fake，让业务与校验逻辑不直接依赖全局 window。
 */
export type TodoStorage = {
  /** 读取原始存储字符串；键不存在时返回 null。 */
  read(): string | null;
  /** 将序列化后的字符串写入存储。 */
  write(raw: string): void;
};

/** 逐项解析原始 JSON 后的结果：保留所有合法首条任务并统计跳过的坏记录数。 */
export type ParseTodosResult = {
  todos: Todo[];
  skippedCount: number;
};

/** 启动恢复结果：包含可用任务列表、可选降级提示文案以及是否整体读取失败。 */
export type LoadTodosResult = {
  todos: Todo[];
  warning: string | null;
  loadFailed: boolean;
};

/**
 * 判断未知值是否为普通键值对对象（排除 null 与数组）。
 *
 * @param value 待检查的未知值。
 * @returns 是否为普通记录对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 判断未知值是否为合法的 Todo 项（正安全整数 id、字符串 text、布尔 completed）。
 *
 * @param value 待校验的数组元素。
 * @returns 是否满足 Todo 结构约束。
 */
function isValidTodo(value: unknown): value is Todo {
  // 校验普通对象以及 id（正安全整数）、text（string）、completed（boolean）三个字段。
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.text === "string" &&
    typeof value.completed === "boolean"
  );
}

/**
 * 解析并逐项校验原始 JSON 字符串：非数组或非法 JSON 直接抛错；合法数组中过滤非法项，对重复 id 保留首条合法记录并统计跳过条数。
 *
 * @param raw 从存储中读出的原始 JSON 字符串。
 * @returns 有效任务数组与跳过的非法/重复记录数量。
 */
export function parseTodos(raw: string): ParseTodosResult {
  // 解析 JSON 并确认根节点是数组，再用 Set<number> 逐项校验与去重（同 id 保留首条合法记录），返回浅拷贝与 skippedCount。
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Stored todos must be an array");
  }

  const seenIds = new Set<number>();
  const todos: Todo[] = [];
  let skippedCount = 0;

  for (const item of parsed) {
    if (!isValidTodo(item)) {
      skippedCount += 1;
      continue;
    }
    if (seenIds.has(item.id)) {
      skippedCount += 1;
      continue;
    }
    seenIds.add(item.id);
    todos.push({ id: item.id, text: item.text, completed: item.completed });
  }

  return { todos, skippedCount };
}

/**
 * 从存储适配器恢复初始任务：缺键回退示例任务，部分损坏返回恢复提示，读写或整份解析失败时回退默认任务且标记 loadFailed。
 *
 * @param storage 任意实现了 TodoStorage 的同步存储适配器。
 * @param fallback 缺键或读取失败时使用的默认任务列表。
 * @returns 恢复后的任务列表、降级提示和失败标记。
 */
export function loadTodosFromStorage(
  storage: TodoStorage,
  fallback: readonly Todo[] = INITIAL_TODOS,
): LoadTodosResult {
  // 用 try/catch 包裹 storage.read() 与 parseTodos(raw)，区分缺键、完好恢复、部分恢复和整体读失败四种情况。
  try {
    const raw = storage.read();
    if (raw === null) {
      return {
        todos: fallback.map((todo) => ({ ...todo })),
        warning: null,
        loadFailed: false,
      };
    }

    const parsed = parseTodos(raw);
    return {
      todos: parsed.todos,
      warning:
        parsed.skippedCount > 0
          ? `检测到损坏记录：已恢复 ${parsed.todos.length} 条有效任务，跳过 ${parsed.skippedCount} 条非法或重复项。`
          : null,
      loadFailed: false,
    };
  } catch {
    return {
      todos: fallback.map((todo) => ({ ...todo })),
      warning: "读取本地存储失败，已回退到默认任务（原存储数据未被覆盖）。",
      loadFailed: true,
    };
  }
}
