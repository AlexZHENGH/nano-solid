// Vite 插件公共入口：供仓内 vite.config.ts 与对外发布的 nano-solid/vite 子路径导出共享。
export { nanoSolid, type NanoSolidPluginOptions } from "./compiler/vite-plugin.ts";
