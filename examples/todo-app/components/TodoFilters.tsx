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
export function TodoFilters(props: TodoFiltersProps): Node {
  // 渲染 #filter-all、#filter-active、#filter-completed 三个按钮并按 props.filter() 切换激活态样式。
  return (
    <div class="ns-actions ns-todo-filters">
      <button
        id="filter-all"
        type="button"
        class={() => (props.filter() === "all" ? "ns-btn ns-btn-active" : "ns-btn")}
        onClick={() => props.onSelect("all")}
      >
        全部
      </button>
      <button
        id="filter-active"
        type="button"
        class={() => (props.filter() === "active" ? "ns-btn ns-btn-active" : "ns-btn")}
        onClick={() => props.onSelect("active")}
      >
        未完成
      </button>
      <button
        id="filter-completed"
        type="button"
        class={() => (props.filter() === "completed" ? "ns-btn ns-btn-active" : "ns-btn")}
        onClick={() => props.onSelect("completed")}
      >
        已完成
      </button>
    </div>
  );
}
