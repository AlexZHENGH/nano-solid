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
export function TodoComposer(props: TodoComposerProps): Node {
  // 维护局部 draft 信号与 composerInput ref，提交非空文案时在 batch 中调用 props.onAdd 与清空草稿，并重新聚焦输入框。
  const [draft, setDraft] = createSignal("");
  let composerInput: HTMLInputElement | undefined;

  /** 提交非空草稿、批量清空输入框并重新聚焦。 */
  const handleAdd = () => {
    const text = draft().trim();
    if (!text) return;
    batch(() => {
      props.onAdd(text);
      setDraft("");
    });
    composerInput?.focus();
  };

  return (
    <div class="ns-todo-composer">
      <input
        id="todo-input"
        type="text"
        class="ns-input"
        placeholder="输入待办事项..."
        aria-label="新建待办事项"
        ref={(element) => {
          composerInput = element;
        }}
        value={() => draft()}
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
      <button
        id="add-todo"
        type="button"
        class="ns-btn"
        disabled={() => draft().trim().length === 0}
        onClick={handleAdd}
      >
        添加
      </button>
    </div>
  );
}
