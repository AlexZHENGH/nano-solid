import { Show } from "nano-solid";

/** 持久化降级提示条组件的输入属性。 */
export type PersistenceBannerProps = {
  /** 启动恢复时的降级提示文案，无异常时为 null。 */
  loadWarning: () => string | null;
  /** 最近一次写入存储是否失败。 */
  saveError: () => boolean;
};

/**
 * 展示启动恢复警告与保存失败告警的纯视图组件。
 *
 * @param props 响应式警告状态 getter。
 * @returns 包含两条条件提示条的原生 DOM 节点。
 */
export function PersistenceBanner(props: PersistenceBannerProps): Node {
  // 用两个 <Show> 分别渲染 #load-warning（.ns-banner-warn）与 #save-error（.ns-banner-danger）。
  return (
    <div>
      <Show when={() => props.loadWarning() !== null}>
        {() => (
          <p id="load-warning" class="ns-banner ns-banner-warn">
            {() => props.loadWarning() ?? ""}
          </p>
        )}
      </Show>
      <Show when={props.saveError}>
        {() => (
          <p id="save-error" class="ns-banner ns-banner-danger">
            保存失败。本次改动仍保留在页面中，请稍后重试。
          </p>
        )}
      </Show>
    </div>
  );
}
