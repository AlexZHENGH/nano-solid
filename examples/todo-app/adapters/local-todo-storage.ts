import { DEFAULT_STORAGE_KEY, type TodoStorage } from "../storage.ts";

/**
 * 创建基于浏览器 window.localStorage 的同步存储适配器。
 * 每次 read / write 时才访问 window.localStorage，确保受限环境下访问对象本身抛错也能被上层统一捕获。
 *
 * @param key 存储使用的 localStorage 键名，默认 DEFAULT_STORAGE_KEY。
 * @returns 符合 TodoStorage 接口的浏览器适配器。
 */
export function createLocalTodoStorage(key = DEFAULT_STORAGE_KEY): TodoStorage {
  return {
    read(): string | null {
      return window.localStorage.getItem(key);
    },
    write(raw: string): void {
      window.localStorage.setItem(key, raw);
    },
  };
}
