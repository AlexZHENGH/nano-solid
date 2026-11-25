import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Dispose, ForProps, JSXChild, MemoOptions, ShowProps } from "./index.ts";
import { batch, createMemo, createRoot, createSignal, render, untrack } from "./index.ts";
import type { JSX } from "./jsx-runtime.ts";
import { nanoSolid, type NanoSolidPluginOptions } from "./vite.ts";

const ROOT_DIR = process.cwd();
const DIST_DIR = resolve(ROOT_DIR, "dist");

/** 递归收集目录下所有文件的相对路径（统一转为正斜杠），便于检查 dist 产物纯净度。 */
function listRelativeFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

/** 清理 dist/ 并执行 tsconfig.build.json 构建，确保每次校验都基于最新库产物。 */
function buildLibrary(): void {
  rmSync(DIST_DIR, { recursive: true, force: true });
  const tscBin = resolve(ROOT_DIR, "node_modules/.bin/tsc");
  execFileSync(tscBin, ["-p", "tsconfig.build.json"], { cwd: ROOT_DIR, stdio: "pipe" });
}

describe("库产物构建与类型声明契约", () => {
  it("tsc -p tsconfig.build.json 在 dist/ 中产出全部公共入口的 JS、.d.ts 与 source map，且不含测试与演示入口", () => {
    buildLibrary();

    const files = listRelativeFiles(DIST_DIR);
    // 验证四个核心对外文件入口（. / jsx-runtime / compiler-runtime / vite）及其声明与映射齐全。
    const expectedEntries = [
      "index.js",
      "index.d.ts",
      "index.js.map",
      "index.d.ts.map",
      "jsx-runtime.js",
      "jsx-runtime.d.ts",
      "compiler-runtime.js",
      "compiler-runtime.d.ts",
      "vite.js",
      "vite.d.ts",
    ];
    for (const file of expectedEntries) {
      expect(files).toContain(file);
    }

    // 不得混入测试文件、演示入口 main 或嵌套的 src/ 目录。
    expect(files.some((file) => file.includes(".test."))).toBe(false);
    expect(files.some((file) => file.startsWith("main."))).toBe(false);
    expect(files.some((file) => file.startsWith("src/"))).toBe(false);
  });

  it("dist/ 产物将相对 .ts 导入重写为 .js，并可直接被原生 Node ESM 加载运行", async () => {
    buildLibrary();

    const indexJs = readFileSync(resolve(DIST_DIR, "index.js"), "utf8");
    const runtimeJs = readFileSync(resolve(DIST_DIR, "compiler-runtime.js"), "utf8");
    const viteJs = readFileSync(resolve(DIST_DIR, "vite.js"), "utf8");

    // 产出 JS 中绝不能残留 .ts 扩展名，否则外部项目在 Node 原生 ESM 中加载会直接报错。
    expect(indexJs).not.toMatch(/from\s+["']\.\/[^"']+\.ts["']/);
    expect(runtimeJs).not.toMatch(/from\s+["']\.\/[^"']+\.ts["']/);
    expect(viteJs).not.toMatch(/from\s+["']\.\/[^"']+\.ts["']/);

    // 直接通过原生 Node 动态 import() 加载编译后的 dist/index.js 与 dist/vite.js。
    const core = (await import(
      `${pathToFileURL(resolve(DIST_DIR, "index.js")).href}?t=${Date.now()}`
    )) as typeof import("./index.ts");

    const seen: number[] = [];
    const dispose = core.createRoot((stop) => {
      const [a, setA] = core.createSignal(1);
      const [b, setB] = core.createSignal(2);
      const sum = core.createMemo(() => a() + b());
      core.createEffect(() => {
        seen.push(sum());
      });
      core.batch(() => {
        setA(10);
        setB(20);
      });
      expect(core.untrack(() => sum())).toBe(30);
      return stop;
    });
    expect(seen).toEqual([3, 30]);
    dispose();

    const viteEntry = (await import(
      `${pathToFileURL(resolve(DIST_DIR, "vite.js")).href}?t=${Date.now()}`
    )) as typeof import("./vite.ts");
    const plugin = viteEntry.nanoSolid();
    expect(plugin.name).toBe("nano-solid");
    expect(plugin.enforce).toBe("pre");
  });

  it("dist/*.d.ts 完整声明公共 API、JSX 命名空间、compiler-runtime 与 Vite 插件类型", () => {
    buildLibrary();

    const indexDts = readFileSync(resolve(DIST_DIR, "index.d.ts"), "utf8");
    const jsxDts = readFileSync(resolve(DIST_DIR, "jsx-runtime.d.ts"), "utf8");
    const runtimeDts = readFileSync(resolve(DIST_DIR, "compiler-runtime.d.ts"), "utf8");
    const viteDts = readFileSync(resolve(DIST_DIR, "vite.d.ts"), "utf8");

    expect(indexDts).toContain("createSignal");
    expect(indexDts).toContain("createMemo");
    expect(indexDts).toContain("batch");
    expect(indexDts).toContain("untrack");
    expect(indexDts).toContain("render");
    expect(indexDts).toContain("For");
    expect(indexDts).toContain("Show");

    expect(jsxDts).toContain("export declare namespace JSX");
    expect(jsxDts).toContain("IntrinsicElements");

    expect(runtimeDts).toContain("createReactiveText");
    expect(runtimeDts).toContain("appendChildren");
    expect(runtimeDts).toContain("bindProperty");
    expect(runtimeDts).toContain("onCleanup");

    expect(viteDts).toContain("nanoSolid");
    expect(viteDts).toContain("NanoSolidPluginOptions");
  });

  it("公共 API 与 JSX.IntrinsicElements 类型签名保持精确契约", () => {
    // 响应式原语与挂载函数的类型契约。
    expectTypeOf(createSignal<number>).returns.toEqualTypeOf<
      readonly [() => number, (next: number) => void]
    >();
    expectTypeOf(createMemo<string>).toBeCallableWith(() => "ok");
    expectTypeOf(createMemo<string>).toBeCallableWith(() => "ok", {} as MemoOptions);
    expectTypeOf(batch<number>).returns.toEqualTypeOf<number>();
    expectTypeOf(untrack<boolean>).returns.toEqualTypeOf<boolean>();
    expectTypeOf(createRoot<void>).returns.toEqualTypeOf<void>();
    expectTypeOf(render).returns.toEqualTypeOf<Dispose>();

    // 控制流组件与子节点类型契约。
    expectTypeOf<ShowProps<string>["children"]>().toEqualTypeOf<() => Node>();
    expectTypeOf<ForProps<number>["children"]>().toEqualTypeOf<
      (item: () => number, index: () => number) => Node
    >();
    expectTypeOf<JSX.Element>().toEqualTypeOf<Node>();
    expectTypeOf<JSX.IntrinsicElements["input"]["ref"]>().toEqualTypeOf<
      ((element: HTMLInputElement) => void) | undefined
    >();
    expectTypeOf<JSX.IntrinsicElements["button"]["disabled"]>().toEqualTypeOf<
      boolean | (() => boolean) | undefined
    >();
    expectTypeOf<JSX.IntrinsicElements["div"]["children"]>().toEqualTypeOf<JSXChild | undefined>();

    // Vite 插件入口类型契约。
    expectTypeOf(nanoSolid).parameter(0).toEqualTypeOf<NanoSolidPluginOptions | undefined>();
  });
});
