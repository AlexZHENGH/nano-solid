// 框架公共 API 入口：对外只暴露响应式原语、控制流组件、挂载入口与配套类型，隔离内部实现文件。
export {
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  type Dispose,
  type EffectCallback,
} from "./reactive.ts";
export { render, type ElementProps, type TargetedEvent } from "./dom.ts";
export { For, Show, type ForProps, type ShowProps } from "./control-flow.ts";
export type { Component, JSXChild } from "./jsx-runtime.ts";
