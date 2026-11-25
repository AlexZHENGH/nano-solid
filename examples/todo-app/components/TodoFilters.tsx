import type { TodoFilter } from "../types.ts";

/** 筛选栏组件的输入属性。 */
export type TodoFiltersProps = {
  /** 当前选中的筛选条件 getter。 */
  filter: () => TodoFilter;
  /** 切换筛选条件时触发的回调。 */
  onSelect: (next: TodoFilter) => void;
};

/**
 * 全部 / 未完成 / 已完成筛选切换栏组件。
 *
 * @param props 当前筛选状态与切换回调。
 * @returns 筛选按钮组容器。
 */
export function TodoFilters(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  props: TodoFiltersProps,
): Node {
  // 渲染 #filter-all、#filter-active、#filter-completed 三个按钮并按 props.filter() 切换激活态样式。
  // TODO: 实现 TodoFilters
  throw new Error("TODO: 实现 TodoFilters");
}
