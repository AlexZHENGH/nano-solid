import { Show, createSignal, type TaskScheduler } from "nano-solid";
import { PersistenceBanner } from "./components/PersistenceBanner.tsx";
import { ScheduledCompletedDetails } from "./components/ScheduledCompletedDetails.tsx";
import { TodoComposer } from "./components/TodoComposer.tsx";
import { TodoFilters } from "./components/TodoFilters.tsx";
import { TodoList } from "./components/TodoList.tsx";
import type { TodoStore } from "./todo-store.ts";

/** Todo 应用根组件的输入属性：只接收由组合根注入的 TodoStore，不直接触碰任何存储适配器。 */
export type AppProps = {
  /** 由入口组合根或测试辅助函数创建的 TodoStore 实例。 */
  store: TodoStore;
  /** 提供调度器时，展开后的明细会在以后的轮次整理。 */
  detailsScheduler?: TaskScheduler;
};

/**
 * Todo 示例应用根视图：把领域状态与命令分发给各纯视图子组件，自身仅保留底部明细面板的折叠开关。
 *
 * @param props 注入的 TodoStore。
 * @returns 完整 Todo 卡片的原生 DOM 节点。
 */
export function App(props: AppProps): Node {
  // 用注入的 props.store 驱动视图，把各区块交给 PersistenceBanner、TodoComposer、TodoFilters、TodoList 渲染，自身只保留底部明细的折叠开关。
  const { store } = props;
  const [showCompletedDetails, setShowCompletedDetails] = createSignal(false);

  return (
    <section class="ns-card">
      {/* 1. 顶部标题与由 store.remainingCount 驱动的剩余状态徽章。 */}
      <div class="ns-card-header">
        <h1 class="ns-card-title">nano-solid Todo</h1>
        <span
          id="remaining-badge"
          class={() => (store.remainingCount() > 0 ? "ns-badge" : "ns-badge ns-badge-muted")}
        >
          {() => (store.remainingCount() === 0 ? "全部完成" : `剩余 ${store.remainingCount()} 项`)}
        </span>
      </div>

      {/* 2. 持久化恢复警告与写入失败提示条。 */}
      <PersistenceBanner loadWarning={store.loadWarning} saveError={store.saveError} />

      {/* 3. 新建待办输入栏（内部维护局部 draft 与 ref 自动聚焦）。 */}
      <TodoComposer onAdd={store.addTodo} />

      {/* 4. 筛选切换栏。 */}
      <TodoFilters filter={store.filter} onSelect={store.setFilter} />

      {/* 5. 任务列表（内部维护行内编辑态并用 <For> 复用节点）。 */}
      <TodoList
        todos={store.visibleTodos}
        onToggle={store.toggleTodo}
        onUpdate={store.updateTodo}
        onRemove={store.removeTodo}
      />

      {/* 6. 底部统计行与按需展开的惰性已完成明细。 */}
      <p id="todo-stats" class="ns-meta">
        共 <code>{() => store.todos().length}</code> 项，当前显示{" "}
        <code>{() => store.visibleTodos().length}</code> 项，已完成{" "}
        <code>{() => store.completedCount()}</code> 项
      </p>

      <hr class="ns-divider" />
      <div class="ns-actions">
        <button
          id="toggle-completed-details"
          type="button"
          class="ns-btn ns-btn-sm"
          onClick={() => setShowCompletedDetails(!showCompletedDetails())}
        >
          {() => (showCompletedDetails() ? "收起已完成明细" : "查看已完成明细")}
        </button>
      </div>
      <Show when={showCompletedDetails}>
        {() => {
          // 只在展开的分支里创建明细组件。关闭分支后，它能自行取消还没开始的工作。
          if (props.detailsScheduler) {
            return (
              <ScheduledCompletedDetails
                todos={store.todos}
                calculate={store.completedDetails}
                scheduler={props.detailsScheduler}
              />
            );
          }
          return (
            <p id="completed-details" class="ns-meta">
              {store.completedDetails}
            </p>
          );
        }}
      </Show>
    </section>
  );
}
