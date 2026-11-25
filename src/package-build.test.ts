import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { transformJSX } from "./compiler/transform.ts";
import type { Dispose, ForProps, JSXChild, MemoOptions, ShowProps } from "./index.ts";
import { batch, createMemo, createRoot, createSignal, render, untrack } from "./index.ts";
import type { JSX } from "./jsx-runtime.ts";
import { nanoSolid, type NanoSolidPluginOptions } from "./vite.ts";

const ROOT_DIR = process.cwd();
const DIST_DIR = resolve(ROOT_DIR, "dist");

/** 去除 JSONC 单行注释，便于测试读取带教学注释的 tsconfig.json。 */
function parseJsonc(raw: string): Record<string, unknown> {
  const withoutComments = raw.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutComments) as Record<string, unknown>;
}

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

describe("package.json 条件导出、仓内源码条件与 Todo 迁移", () => {
  it.skip("package.json 声明 files、5 个正式 exports 子路径且每个入口满足 nano-solid-source -> types -> default 顺序", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT_DIR, "package.json"), "utf8")) as {
      files?: string[];
      imports?: Record<string, unknown>;
      exports?: Record<string, Record<string, string>>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    // 1. 发布白名单只包含 dist，且不再残留旧的仓内私有 #nano-solid 映射。
    expect(pkg.files).toEqual(["dist"]);
    expect(pkg.imports).toBeUndefined();

    // 2. vite 声明为可选 peerDependency，不强迫仅使用核心运行时的用户安装 Vite。
    expect(pkg.peerDependencies?.vite).toBeDefined();
    expect(pkg.peerDependenciesMeta?.vite?.optional).toBe(true);

    // 3. 校验全部 5 个对外子路径映射及条件键顺序（types 必须在 default 之前）。
    const expectedSubpaths: Array<[string, string, string, string]> = [
      [".", "./src/index.ts", "./dist/index.d.ts", "./dist/index.js"],
      ["./jsx-runtime", "./src/jsx-runtime.ts", "./dist/jsx-runtime.d.ts", "./dist/jsx-runtime.js"],
      [
        "./jsx-dev-runtime",
        "./src/jsx-runtime.ts",
        "./dist/jsx-runtime.d.ts",
        "./dist/jsx-runtime.js",
      ],
      [
        "./compiler-runtime",
        "./src/compiler-runtime.ts",
        "./dist/compiler-runtime.d.ts",
        "./dist/compiler-runtime.js",
      ],
      ["./vite", "./src/vite.ts", "./dist/vite.d.ts", "./dist/vite.js"],
    ];

    expect(Object.keys(pkg.exports ?? {})).toEqual(expectedSubpaths.map(([subpath]) => subpath));

    for (const [subpath, sourcePath, typesPath, defaultPath] of expectedSubpaths) {
      const entry = pkg.exports?.[subpath];
      expect(entry).toEqual({
        "nano-solid-source": sourcePath,
        types: typesPath,
        default: defaultPath,
      });
      // 条件键顺序决定解析优先级：types 必须排在 default 之前。
      expect(Object.keys(entry ?? {})).toEqual(["nano-solid-source", "types", "default"]);
    }
  });

  it.skip("原生 Node 24 默认条件下通过包名自引用命中 dist/ 产物，并拦截未导出的深层内部路径", () => {
    buildLibrary();

    // 在干净的原生 Node 进程（不开启 nano-solid-source 条件）中校验全部公开子路径与越界拦截。
    const probeScript = `
      const resolved = {
        root: import.meta.resolve("nano-solid"),
        jsxRuntime: import.meta.resolve("nano-solid/jsx-runtime"),
        jsxDevRuntime: import.meta.resolve("nano-solid/jsx-dev-runtime"),
        compilerRuntime: import.meta.resolve("nano-solid/compiler-runtime"),
        vite: import.meta.resolve("nano-solid/vite"),
      };
      const core = await import("nano-solid");
      const [n, setN] = core.createSignal(1);
      setN(2);
      let blockedDistCode = "";
      let blockedSrcCode = "";
      try {
        await import("nano-solid/dist/reactive.js");
      } catch (err) {
        blockedDistCode = err.code ?? String(err);
      }
      try {
        await import("nano-solid/src/reactive.ts");
      } catch (err) {
        blockedSrcCode = err.code ?? String(err);
      }
      console.log(JSON.stringify({ resolved, value: n(), blockedDistCode, blockedSrcCode }));
    `;

    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", probeScript], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    });
    const report = JSON.parse(stdout) as {
      resolved: Record<string, string>;
      value: number;
      blockedDistCode: string;
      blockedSrcCode: string;
    };

    expect(report.resolved.root?.endsWith("/dist/index.js")).toBe(true);
    expect(report.resolved.jsxRuntime?.endsWith("/dist/jsx-runtime.js")).toBe(true);
    expect(report.resolved.jsxDevRuntime?.endsWith("/dist/jsx-runtime.js")).toBe(true);
    expect(report.resolved.compilerRuntime?.endsWith("/dist/compiler-runtime.js")).toBe(true);
    expect(report.resolved.vite?.endsWith("/dist/vite.js")).toBe(true);
    expect(report.value).toBe(2);
    expect(report.blockedDistCode).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
    expect(report.blockedSrcCode).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
  });

  it.skip("仓内配置已启用 nano-solid-source 条件，且编译器默认注入 nano-solid/compiler-runtime", () => {
    const tsconfig = parseJsonc(readFileSync(resolve(ROOT_DIR, "tsconfig.json"), "utf8")) as {
      compilerOptions?: {
        jsxImportSource?: string;
        customConditions?: string[];
      };
    };
    expect(tsconfig.compilerOptions?.jsxImportSource).toBe("nano-solid");
    expect(tsconfig.compilerOptions?.customConditions).toContain("nano-solid-source");

    const viteConfig = readFileSync(resolve(ROOT_DIR, "vite.config.ts"), "utf8");
    expect(viteConfig).toContain("nano-solid-source");
    expect(viteConfig).toContain("defaultClientConditions");

    const compiled = transformJSX("const el = <p>{() => count()}</p>;");
    expect(compiled).not.toBeNull();
    expect(compiled!.code).toContain('from "nano-solid/compiler-runtime"');
    expect(compiled!.code).not.toContain("#nano-solid");
  });

  it.skip("examples/todo-app 已全面迁移到正式包名 nano-solid，不再残留 #nano-solid", () => {
    const todoFiles = [
      "examples/todo-app/App.tsx",
      "examples/todo-app/main.tsx",
      "examples/todo-app/App.test.tsx",
    ];
    for (const relPath of todoFiles) {
      const content = readFileSync(resolve(ROOT_DIR, relPath), "utf8");
      expect(content).toContain('from "nano-solid"');
      expect(content).not.toContain("#nano-solid");
    }
  });
});
