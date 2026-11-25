import { resolve } from "node:path";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { nanoSolid, shouldTransformId } from "./vite-plugin.ts";

/** 直接调用 Vite 插件的 transform 钩子，兼容函数形态与对象钩子形态。 */
function invokePluginTransform(plugin: Plugin, code: string, id: string) {
  const hook = plugin.transform;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  if (!handler) {
    throw new Error("Plugin transform hook is missing");
  }
  return handler.call({} as never, code, id);
}

describe("Vite 插件与 Todo 真实打包验证", () => {
  it("插件声明 enforce: pre，并精确区分 .tsx/HMR 查询与虚拟模块、node_modules、静态资源查询及 exclude 规则", () => {
    const plugin = nanoSolid();
    expect(plugin.name).toBe("nano-solid");
    expect(plugin.enforce).toBe("pre");

    // 正常 .tsx/.jsx 与带 HMR 时间戳的模块应进入编译。
    expect(shouldTransformId("/repo/examples/todo-app/App.tsx")).toBe(true);
    expect(shouldTransformId("/repo/src/Card.jsx")).toBe(true);
    expect(shouldTransformId("/repo/examples/todo-app/App.tsx?t=1732500000")).toBe(true);
    expect(shouldTransformId("/repo/examples/todo-app/App.tsx?import")).toBe(true);

    // 虚拟模块、依赖目录、非 JSX 文件与静态资源查询必须跳过。
    expect(shouldTransformId("\0virtual:entry.tsx")).toBe(false);
    expect(shouldTransformId("/repo/node_modules/pkg/App.tsx")).toBe(false);
    expect(shouldTransformId("C:\\repo\\node_modules\\pkg\\App.tsx")).toBe(false);
    expect(shouldTransformId("/repo/src/reactive.ts")).toBe(false);
    expect(shouldTransformId("/repo/styles/ui.css")).toBe(false);
    expect(shouldTransformId("/repo/examples/todo-app/App.tsx?raw")).toBe(false);
    expect(shouldTransformId("/repo/examples/todo-app/App.tsx?url")).toBe(false);
    expect(shouldTransformId("/repo/examples/todo-app/App.tsx?worker")).toBe(false);
    expect(shouldTransformId("/repo/examples/todo-app/App.tsx?inline")).toBe(false);

    // 自定义 exclude 规则应生效。
    expect(
      shouldTransformId("/repo/src/jsx-runtime.test.tsx", [/src[\\/]jsx-runtime\.test\.tsx$/]),
    ).toBe(false);
  });

  it("无改写文件返回 null，改写后的文件返回去掉查询串的 source map 并透传 runtimeModule", () => {
    const plugin = nanoSolid({ runtimeModule: "nano-solid/compiler-runtime" });

    expect(invokePluginTransform(plugin, "export const n = 1;", "/repo/src/a.tsx")).toBeNull();
    expect(invokePluginTransform(plugin, "const el = <Counter />;", "/repo/src/b.tsx")).toBeNull();
    expect(
      invokePluginTransform(plugin, "const el = <div>raw</div>;", "/repo/src/c.tsx?raw"),
    ).toBeNull();

    const result = invokePluginTransform(
      plugin,
      "export const view = () => <p>{() => count()}</p>;",
      "/repo/src/Demo.tsx?t=998877",
    );
    expect(result).not.toBeNull();
    if (result && typeof result === "object" && "code" in result) {
      expect(result.code).toContain('from "nano-solid/compiler-runtime"');
      expect(result.code).toContain('document.createElement("p")');
      expect(result.map).not.toBeNull();
      if (result.map && typeof result.map === "object" && "sources" in result.map) {
        expect(result.map.sources).toContain("/repo/src/Demo.tsx");
      }
    }
  });

  it("通过真实 Vite 打包 examples/todo-app/App.tsx：原生标签直出 DOM，仅保留控制流组件调用并生成 source map", async () => {
    const output = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [nanoSolid()],
      build: {
        write: false,
        minify: false,
        sourcemap: true,
        lib: {
          entry: resolve(process.cwd(), "examples/todo-app/App.tsx"),
          formats: ["es"],
        },
        rollupOptions: {
          external: [/^nano-solid(\/|$)/],
        },
      },
    });

    const outputs = Array.isArray(output) ? output : [output];
    const firstOutput = outputs[0];
    if (!firstOutput || !("output" in firstOutput)) {
      throw new Error("Expected RollupOutput from Vite build");
    }

    const chunk = firstOutput.output.find((item) => item.type === "chunk");
    expect(chunk).toBeDefined();
    if (!chunk || chunk.type !== "chunk") return;

    // 打包产物中已注入 compiler-runtime 并直接调用原生 DOM API。
    expect(chunk.code).toContain("nano-solid/compiler-runtime");
    expect(chunk.code).toContain('document.createElement("section")');
    expect(chunk.code).toContain('document.createElement("input")');
    expect(chunk.code).toContain('document.createElement("button")');
    expect(chunk.code).toContain('addEventListener("click"');
    expect(chunk.code).toContain('addEventListener("input"');
    expect(chunk.code).toContain('addEventListener("change"');

    // 所有原生 HTML 标签均已脱离 jsx() / jsxs() / jsxDEV() 运行时路径。
    expect(chunk.code).not.toMatch(
      /jsx(?:s|DEV)?\(\s*["'](section|div|h1|span|input|button|ul|li|p|code|hr)["']/,
    );

    // 控制流组件 For / Show 仍走运行时调用，且产物附带指向 App.tsx 的 source map。
    expect(chunk.code).toMatch(/jsx(?:s|DEV)?\(\s*For\b/);
    expect(chunk.code).toMatch(/jsx(?:s|DEV)?\(\s*Show\b/);
    expect(chunk.map).not.toBeNull();
    expect(chunk.map?.sources.some((source) => source.endsWith("App.tsx"))).toBe(true);
  });
});
