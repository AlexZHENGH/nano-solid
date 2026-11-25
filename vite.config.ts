import { resolve } from "node:path";
import { defaultClientConditions, defineConfig } from "vite";
import { nanoSolid } from "./src/vite.ts";

/**
 * 仓库根目录 Vite 配置：
 * 1. 通过 resolve.conditions 开启仓内自定义条件 nano-solid-source，同时保留 Vite 默认客户端条件，实现零构建实时 HMR；
 * 2. 接入 nanoSolid() 编译器插件，在 dev、build 与 Vitest 中统一编译原生 JSX；
 * 3. 排除 src/jsx-runtime.test.tsx，确保 jsx-runtime 回退链路继续得到直接测试覆盖；
 * 4. 配置多页生产构建入口输出到 dist-demos/，与 dist/ 中的可发布库产物彻底隔离。
 */
export default defineConfig({
  resolve: {
    conditions: ["nano-solid-source", ...defaultClientConditions],
  },
  plugins: [
    nanoSolid({
      exclude: [/src[\\/]jsx-runtime\.test\.tsx$/],
    }),
  ],
  build: {
    // 示例页打包输出到 dist-demos/，与 dist/ 中的可发布库产物彻底隔离。
    outDir: "dist-demos",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        todo: resolve(import.meta.dirname, "examples/todo-app/index.html"),
      },
    },
  },
});
