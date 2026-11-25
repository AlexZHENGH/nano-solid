import { createAsyncResource, createSignal, onCleanup } from "nano-solid";
import type { AsyncTodoRepository } from "./async-repository.ts";
import { createTodoModel } from "./todo-model.ts";
import type { TodoStore } from "./todo-store.ts";
import type { Todo } from "./types.ts";

/** 加载完成前隐藏编辑界面，加载失败后允许重试。 */
export type TodoLoadStatus = "loading" | "ready" | "error";

/** 异步示例沿用原来的任务模型，再提供读写状态和重试动作。 */
export type AsyncTodoStore = TodoStore & {
  readonly loadStatus: () => TodoLoadStatus;
  readonly saving: () => boolean;
  readonly hasUnsavedChanges: () => boolean;
  retryLoad(): Promise<void>;
  retrySave(): Promise<void>;
};

/**
 * 在当前 Owner 下加载任务，并将用户编辑按顺序交给异步仓库。
 * @param repository 支持读取、保存和取消的仓库。
 * @returns 可交给 App 使用的任务模型和异步读写状态。
 */
export function createAsyncTodoStore(repository: AsyncTodoRepository): AsyncTodoStore {
  // pending 是还没有确认的最新快照。activeSave 占住唯一的写入位置，卸载时也能通过它取消。
  const [pending, setPending] = createSignal<readonly Todo[] | undefined>(undefined);
  const [loadStatus, setLoadStatus] = createSignal<TodoLoadStatus>("loading");
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal(false);
  let activeSave: AbortController | undefined;
  let disposed = false;

  const resource = createAsyncResource((signal) => repository.load(signal));
  const { model, restoreTodos } = createTodoModel([], (snapshot) => {
    // 连续编辑只覆盖待保存的快照，已经发出的那份由正在执行的写入继续持有。
    setPending(snapshot);
    void savePending();
  });

  /** 先装入仓库快照，再让界面进入可编辑状态。 */
  async function loadTodos(): Promise<void> {
    setLoadStatus("loading");
    await resource.reload();
    if (disposed) return;

    // 恢复已有数据时不调用编辑回调，避免把刚读到的快照再写回去。
    const result = resource.state();
    if (result.status === "success") {
      restoreTodos(result.data);
      setLoadStatus("ready");
    } else if (result.status === "error") {
      setLoadStatus("error");
    }
  }

  /** 只在首次读取失败时重试，已经开放编辑的列表留在本地。 */
  async function retryLoad(): Promise<void> {
    if (!disposed && loadStatus() === "error") await loadTodos();
  }

  /**
   * 在一个保存循环内依次确认快照，失败的快照仍可重试。
   * @returns 本轮保存结束时完成的 Promise。正在保存时，由现有循环负责补存。
   */
  async function savePending(): Promise<void> {
    // 没有未确认快照、已有写入或已卸载时，当前调用无需发请求。
    if (disposed || activeSave !== undefined || pending() === undefined) return;

    // 每次只提交一份快照。旧快照确认后，只有待保存快照仍是它时才算保存完成。
    const controller = new AbortController();
    activeSave = controller;

    try {
      setSaving(true);
      while (!controller.signal.aborted) {
        // 保存前记住这次发出的列表。用户继续编辑时，pending 会指向新的列表。
        const snapshot = pending();
        if (snapshot === undefined) return;
        setSaveError(false);

        // 只接住仓库的失败，留住本地列表和 pending，让用户可以重试。
        try {
          await repository.save(snapshot, controller.signal);
        } catch {
          if (!controller.signal.aborted) setSaveError(true);
          return;
        }

        // 卸载后的迟到确认不应再改状态。仍然是本次快照时才可以清空 pending。
        if (controller.signal.aborted) return;
        if (pending() === snapshot) setPending(undefined);
      }
    } finally {
      // 正常结束和失败都要归还写入位置，供后续编辑或重试使用。
      activeSave = undefined;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  // 只有初次读取完成且 Owner 还活着时，编辑命令才可以改动任务列表。
  const canEdit = () => !disposed && loadStatus() === "ready";
  onCleanup(() => {
    disposed = true;
    activeSave?.abort();
  });
  void loadTodos();

  return {
    ...model,
    // 同步版 App 的本地恢复警告在这里为空，异步读取失败由 loadStatus 显示。
    loadWarning: () => null,
    saveError,
    loadStatus,
    saving,
    hasUnsavedChanges: () => pending() !== undefined,
    retryLoad,
    retrySave: savePending,
    // 业务规则仍由 model 执行，异步层只负责在加载和卸载边界挡住编辑。
    addTodo: (text) => {
      if (canEdit()) model.addTodo(text);
    },
    toggleTodo: (id) => {
      if (canEdit()) model.toggleTodo(id);
    },
    removeTodo: (id) => {
      if (canEdit()) model.removeTodo(id);
    },
    updateTodo: (id, text) => {
      if (canEdit()) model.updateTodo(id, text);
    },
  };
}
