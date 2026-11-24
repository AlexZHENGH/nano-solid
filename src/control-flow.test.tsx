// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { Show } from "./control-flow.ts";
import { createElement, createText, render } from "./dom.ts";
import { createEffect, createSignal, onCleanup } from "./reactive.ts";

describe("条件渲染 <Show>", () => {
  it("按 when 真假挂载主分支或 fallback，切换时释放旧分支副作用与清理回调", () => {
    const container = createElement("div");
    const [visible, setVisible] = createSignal(true);
    const [count, setCount] = createSignal(0);
    const onBranchMount = vi.fn();
    const onBranchCleanup = vi.fn();
    const onFallbackCleanup = vi.fn();
    const seen: number[] = [];

    function ActivePanel(): Node {
      onBranchMount();
      createEffect(() => {
        seen.push(count());
      });
      onCleanup(onBranchCleanup);
      return <p class="active">计数：{() => count()}</p>;
    }

    function EmptyPanel(): Node {
      onCleanup(onFallbackCleanup);
      return <p class="empty">已隐藏</p>;
    }

    const unmount = render(
      () => (
        <section>
          <Show when={visible} fallback={() => <EmptyPanel />}>
            {() => <ActivePanel />}
          </Show>
        </section>
      ),
      container,
    );

    expect(container.querySelector(".active")?.textContent).toBe("计数：0");
    expect(onBranchMount).toHaveBeenCalledTimes(1);
    expect(onBranchCleanup).toHaveBeenCalledTimes(0);

    setCount(1);
    expect(seen).toEqual([0, 1]);

    // 切到 fallback 时，旧分支的 effect 与 onCleanup 必须立即释放。
    setVisible(false);
    expect(container.querySelector(".active")).toBeNull();
    expect(container.querySelector(".empty")?.textContent).toBe("已隐藏");
    expect(onBranchCleanup).toHaveBeenCalledTimes(1);

    setCount(2);
    expect(seen).toEqual([0, 1]);

    // 再次切回主分支时清理 fallback，并创建全新实例。
    setVisible(true);
    expect(onFallbackCleanup).toHaveBeenCalledTimes(1);
    expect(onBranchMount).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".active")?.textContent).toBe("计数：2");

    unmount();
    expect(onBranchCleanup).toHaveBeenCalledTimes(2);
  });

  it("when 的真假结果未变化时保留原有分支实例与 DOM 节点", () => {
    const container = createElement("div");
    const [count, setCount] = createSignal(1);
    const createMain = vi.fn(() => <p id="kept">数值：{() => count()}</p>);

    const unmount = render(
      () => (
        <div>
          <Show when={count} fallback={() => <p>空</p>}>
            {createMain}
          </Show>
        </div>
      ),
      container,
    );

    const firstParagraph = container.querySelector<HTMLParagraphElement>("#kept")!;
    expect(firstParagraph.textContent).toBe("数值：1");
    expect(createMain).toHaveBeenCalledTimes(1);

    // 1 -> 2 仍为真值，不应销毁重建分支节点，只做细粒度文本更新。
    setCount(2);
    expect(container.querySelector("#kept")).toBe(firstParagraph);
    expect(firstParagraph.textContent).toBe("数值：2");
    expect(createMain).toHaveBeenCalledTimes(1);

    // 切到 0（假值）才会真正切换到 fallback。
    setCount(0);
    expect(container.querySelector("#kept")).toBeNull();
    expect(container.textContent).toBe("空");

    unmount();
  });

  it("分支工厂内的 signal 读值不会泄漏为 when 的依赖", () => {
    const container = createElement("div");
    const [visible] = createSignal(true);
    const [label, setLabel] = createSignal("初始");
    const onFactoryRun = vi.fn();

    const unmount = render(
      () => (
        <div>
          <Show when={visible}>
            {() => {
              onFactoryRun();
              // 在分支工厂内同步读一次 label()，不应导致 <Show> 订阅 label。
              const snapshot = label();
              return <p>{snapshot}</p>;
            }}
          </Show>
        </div>
      ),
      container,
    );

    expect(container.textContent).toBe("初始");
    expect(onFactoryRun).toHaveBeenCalledTimes(1);

    setLabel("更新");
    expect(onFactoryRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("初始");

    unmount();
  });

  it("支持省略 fallback，条件切换时在两枚锚点间精准插入并保留前后兄弟节点", () => {
    const container = createElement("div");
    const [show, setShow] = createSignal(false);

    const unmount = render(
      () => (
        <div>
          <span>前</span>
          <Show when={show}>{() => <span>中</span>}</Show>
          <span>后</span>
        </div>
      ),
      container,
    );

    expect(container.textContent).toBe("前后");

    setShow(true);
    expect(container.textContent).toBe("前中后");

    setShow(false);
    expect(container.textContent).toBe("前后");

    unmount();
  });

  it("支持嵌套 <Show>，外层切假时级联释放内层分支与清理回调", () => {
    const container = createElement("div");
    const [outer, setOuter] = createSignal(true);
    const [inner, setInner] = createSignal(true);
    const innerCleanup = vi.fn();

    const unmount = render(
      () => (
        <div>
          <Show when={outer}>
            {() => (
              <Show when={inner}>
                {() => {
                  onCleanup(innerCleanup);
                  return <p>深层内容</p>;
                }}
              </Show>
            )}
          </Show>
        </div>
      ),
      container,
    );

    expect(container.textContent).toBe("深层内容");
    expect(innerCleanup).toHaveBeenCalledTimes(0);

    setOuter(false);
    expect(container.textContent).toBe("");
    expect(innerCleanup).toHaveBeenCalledTimes(1);

    // 外层已关闭，内层条件再变化也不应重新渲染。
    setInner(false);
    setInner(true);
    expect(container.textContent).toBe("");

    unmount();
  });

  it("<Show> 直接作为 render 根节点并在运行期切换分支后，幂等卸载不残留锚点与节点", () => {
    const container = createElement("div");
    const sibling = createElement("span", {}, [createText("容器兄弟")]);
    container.appendChild(sibling);

    const [visible, setVisible] = createSignal(true);
    const fallbackCleanup = vi.fn();

    const unmount = render(
      () => (
        <Show
          when={visible}
          fallback={() => {
            onCleanup(fallbackCleanup);
            return <p>占位分支</p>;
          }}
        >
          {() => <p>初始分支</p>}
        </Show>
      ),
      container,
    );

    expect(container.textContent).toBe("容器兄弟初始分支");

    // 切换到 fallback 后再连续卸载两次，当前分支节点与两枚注释锚点都应彻底移除，只剩原有兄弟。
    setVisible(false);
    expect(container.textContent).toBe("容器兄弟占位分支");

    unmount();
    unmount();

    expect(fallbackCleanup).toHaveBeenCalledTimes(1);
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(sibling);
  });
});
