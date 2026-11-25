import type { Plugin } from "vite";
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { transformJSX, type TransformOptions } from "./transform.ts";

/** nanoSolid Vite 插件的可选配置。 */
export type NanoSolidPluginOptions = {
  /** 编译期辅助函数的导入路径（仓内默认 "#nano-solid/compiler-runtime"）。 */
  runtimeModule?: string;
  /** 跳过编译的模块路径正则列表（例如保留 jsx-runtime.test.tsx 测试回退路径）。 */
  exclude?: RegExp[];
};

/** 属于 Vite 静态资源或 Worker 特殊语义的查询参数，命中时绝不能改写源码。 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
const ASSET_QUERY_KEYS = ["raw", "url", "inline", "worker", "sharedworker", "init"];

/** 去掉模块 ID 末尾的查询参数，提取真实文件路径供扩展名判断与 source map 使用。 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
function stripQuery(id: string): string {
  const queryIndex = id.indexOf("?");
  return queryIndex === -1 ? id : id.slice(0, queryIndex);
}

/**
 * 判断 Vite 传入的模块 ID 是否应交给 nano-solid JSX 编译器处理：
 * 跳过虚拟模块（\0）、node_modules、非 .tsx/.jsx 文件、静态资源查询（?raw/?url 等）与自定义 exclude 规则，
 * 同时保留带 HMR 时间戳（?t=...）的正常模块热更新请求。
 *
 * @param id Vite transform 钩子收到的模块标识符。
 * @param exclude 可选的排除路径正则列表。
 * @returns 是否应执行编译。
 */
export function shouldTransformId(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  id: string,
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  exclude?: RegExp[],
): boolean {
  // 依次过滤虚拟模块、node_modules、exclude 正则、非 [jt]sx 后缀以及 ASSET_QUERY_KEYS 资源查询。
  // TODO: 实现 shouldTransformId
  return false;
}

/**
 * 创建 nano-solid 的 Vite JSX 编译插件：
 * 通过 enforce: "pre" 在 Vite 内置 TSX 转换前运行，把受支持的原生 JSX 编译为直接 DOM 调用并产出 source map，
 * 未支持写法与组件标签保持原 JSX 交给 Vite 后续链路与 jsx-runtime 处理。
 *
 * @param options 可选的运行时导入路径与排除规则。
 * @returns 标准 Vite Plugin 对象。
 */
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
export function nanoSolid(options?: NanoSolidPluginOptions): Plugin {
  return {
    name: "nano-solid",
    enforce: "pre",
    // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
    transform(code, id) {
      // 先调用 shouldTransformId 过滤，再调用 transformJSX 编译并透传 { code, map }，无改动时返回 null。
      // TODO: 实现 transform 钩子
      return null;
    },
  };
}
