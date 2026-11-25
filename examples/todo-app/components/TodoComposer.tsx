// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { batch, createSignal } from "nano-solid";

/** 新建待办输入栏组件的输入属性。 */
export type TodoComposerProps = {
  /** 提交非空任务文案时触发的回调。 */
  onAdd: (text: string) => void;
};

/**
 * 新建待办输入栏组件：内部维护受控 draft 草稿与输入框 ref，提交后批量清空草稿并恢复焦点。
 *
 * @param props 提交回调。
 * @returns 新建输入栏容器元素。
 */
export function TodoComposer(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  props: TodoComposerProps,
): Node {
  // 维护局部 draft 信号与 composerInput ref，提交非空文案时在 batch 中调用 props.onAdd 与清空草稿，并重新聚焦输入框。
  // TODO: 实现 TodoComposer
  throw new Error("TODO: 实现 TodoComposer");
}
