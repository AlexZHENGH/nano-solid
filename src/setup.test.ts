import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

/**
 * 用当前 Node 运行与 pnpm dev 相同的 TypeScript 入口。
 *
 * @returns 去掉末尾空白（包括换行）的终端输出，供断言比较。
 */
function readStartupMessage(): string {
  return execFileSync(process.execPath, ["src/main.ts"], { encoding: "utf8" }).trimEnd();
}

it("能在 Node 中直接运行 TypeScript 入口", () => {
  // 先确认程序可以启动并打印内容，改问候语时这个检查仍然有效。
  expect(readStartupMessage()).not.toBe("");
});

it.skip("入口打印新的问候语", () => {
  // 比较程序实际打印的文字，漏改内容或标点时让测试失败。
  expect(readStartupMessage()).toBe("Building my own nano-solid!");
});
