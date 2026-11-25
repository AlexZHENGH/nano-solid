// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
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
export function PersistenceBanner(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  props: PersistenceBannerProps,
): Node {
  // 用两个 <Show> 分别渲染 #load-warning（.ns-banner-warn）与 #save-error（.ns-banner-danger）。
  // TODO: 实现 PersistenceBanner
  throw new Error("TODO: 实现 PersistenceBanner");
}
