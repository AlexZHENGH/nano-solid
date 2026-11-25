import { resolve } from "node:path";
import { defineConfig } from "vite";
import { nanoSolid } from "./src/vite.ts";

/**
 * 仓库根目录 Vite 配置：
 * 1. 接入 nanoSolid() 编译器插件，在 dev、build 与 Vitest 中统一编译原生 JSX；
 * 2. 排除 src/jsx-runtime.test.tsx，确保 jsx-runtime 回退链路继续得到直接测试覆盖；
 * 3. 配置多页生产构建入口，同时打包根计数器与 Todo 示例应用。
 */
export default defineConfig({
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
