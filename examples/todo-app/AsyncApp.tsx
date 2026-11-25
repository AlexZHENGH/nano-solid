import { Show } from "nano-solid";
import { App } from "./App.tsx";
import type { AsyncTodoStore } from "./async-todo-store.ts";

/** 异步视图与已有的 Todo 视图接收同一份任务状态。 */
export type AsyncAppProps = { store: AsyncTodoStore };

/**
 * 在已有 Todo 视图外显示加载与保存进度。
 * @param props 由入口装配并托管的 Store。
 * @returns 加载中、读取失败或已加载的视图节点。
 */
export function AsyncApp({ store }: AsyncAppProps): Node {
  return (
    <Show
      when={() => store.loadStatus() === "ready"}
      fallback={() => (
        <section class="ns-card">
          {/* 只有拿到仓库快照才开放编辑，避免用临时空列表覆盖已保存的任务。 */}
          <Show when={() => store.loadStatus() === "error"} fallback={() => <p>正在读取任务…</p>}>
            {() => (
              <div>
                <p class="ns-banner ns-banner-danger">暂时读不到任务。</p>
                <button type="button" class="ns-btn" onClick={() => void store.retryLoad()}>
                  重试读取
                </button>
              </div>
            )}
          </Show>
        </section>
      )}
    >
      {() => (
        <div>
          {/* 保存期间保留同一个 App，草稿、焦点和已显示的任务可以继续使用。 */}
          <App store={store} />
          <p id="async-save-status" class="ns-meta">
            {() => {
              if (store.saving()) return "正在保存…";
              return store.hasUnsavedChanges() ? "还有改动未保存" : "全部已保存";
            }}
          </p>
          <Show when={store.saveError}>
            {() => (
              <button type="button" class="ns-btn" onClick={() => void store.retrySave()}>
                重试保存
              </button>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
