import type { TodoStorage } from "../storage.ts";

/** 测试用内存存储 fake：支持预置原始字符串、统计写入次数以及按需模拟读/写抛错。 */
export type MemoryTodoStorage = TodoStorage & {
  /** 读取当前内存槽中保存的原始字符串（null 表示键不存在）。 */
  getRaw(): string | null;
  /** 直接写入任意原始字符串（可用于注入损坏 JSON）。 */
  setRaw(next: string | null): void;
  /** 返回 write 被调用的总次数（含模拟抛错的尝试）。 */
  getWriteCount(): number;
  /** 设置后续 read() 是否抛出异常。 */
  setFailRead(shouldFail: boolean): void;
  /** 设置后续 write() 是否抛出异常。 */
  setFailWrite(shouldFail: boolean): void;
};

/** 构造内存存储 fake 时的初始选项。 */
export type MemoryTodoStorageOptions = {
  initialRaw?: string | null;
  failRead?: boolean;
  failWrite?: boolean;
};

/**
 * 创建一个与浏览器全局状态完全隔离的内存版 TodoStorage，供单元测试与组件交互测试复用。
 *
 * @param options 初始存储内容与读写故障开关。
 * @returns 可观测、可注入故障的内存存储适配器。
 */
export function createMemoryTodoStorage(options?: MemoryTodoStorageOptions): MemoryTodoStorage {
  let raw: string | null = options?.initialRaw ?? null;
  let failRead = options?.failRead ?? false;
  let failWrite = options?.failWrite ?? false;
  let writeCount = 0;

  return {
    read(): string | null {
      if (failRead) {
        throw new Error("Simulated storage read failure");
      }
      return raw;
    },
    write(next: string): void {
      writeCount += 1;
      if (failWrite) {
        throw new Error("Simulated storage write failure");
      }
      raw = next;
    },
    getRaw(): string | null {
      return raw;
    },
    setRaw(next: string | null): void {
      raw = next;
    },
    getWriteCount(): number {
      return writeCount;
    },
    setFailRead(shouldFail: boolean): void {
      failRead = shouldFail;
    },
    setFailWrite(shouldFail: boolean): void {
      failWrite = shouldFail;
    },
  };
}
