// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { For, Show } from "./control-flow.ts";
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

describe("列表渲染 <For>", () => {
  type Todo = { id: number; text: string; completed: boolean };

  it.skip("按 getKey 复用已有 DOM 节点，不可变更新对象时原地更新内容而不重建行", () => {
    const container = createElement("div");
    const [todos, setTodos] = createSignal<Todo[]>([
      { id: 1, text: "写 memo", completed: false },
      { id: 2, text: "写 For", completed: false },
    ]);
    const rowCreates = vi.fn();

    const unmount = render(
      () => (
        <ul>
          <For each={todos} getKey={(todo) => todo.id}>
            {(todo) => {
              rowCreates(todo().id);
              return (
                <li id={`todo-${todo().id}`}>
                  {() => (todo().completed ? "✓" : "○")} {() => todo().text}
                </li>
              );
            }}
          </For>
        </ul>
      ),
      container,
    );

    const firstLi = container.querySelector<HTMLLIElement>("#todo-1")!;
    expect(firstLi.textContent).toBe("○ 写 memo");
    expect(rowCreates).toHaveBeenCalledTimes(2);

    // 不可变更新第 1 条任务（对象引用已变，但 id 仍为 1）：必须复用同一个 <li> 且不重建行组件。
    setTodos(
      todos().map((todo) =>
        todo.id === 1 ? { ...todo, completed: true, text: "已完成 memo" } : todo,
      ),
    );

    expect(container.querySelector("#todo-1")).toBe(firstLi);
    expect(firstLi.textContent).toBe("✓ 已完成 memo");
    expect(rowCreates).toHaveBeenCalledTimes(2);

    unmount();
  });

  it.skip("筛选移除项时释放被删行的 onCleanup 与 effect，并保留其余行实例", () => {
    const container = createElement("div");
    const [todos, setTodos] = createSignal<Todo[]>([
      { id: 1, text: "任务一", completed: false },
      { id: 2, text: "任务二", completed: false },
    ]);
    const cleanedIds: number[] = [];
    const textReads = vi.fn((text: string) => text);

    const unmount = render(
      () => (
        <ul>
          <For each={todos} getKey={(todo) => todo.id}>
            {(todo) => {
              const id = todo().id;
              onCleanup(() => cleanedIds.push(id));
              return <li id={`todo-${id}`}>{() => textReads(todo().text)}</li>;
            }}
          </For>
        </ul>
      ),
      container,
    );

    const secondLi = container.querySelector<HTMLLIElement>("#todo-2")!;
    expect(cleanedIds).toEqual([]);

    // 移除 id = 1 后，仅第 1 行被清理，第 2 行保持原 DOM 实例。
    setTodos(todos().filter((todo) => todo.id !== 1));
    expect(cleanedIds).toEqual([1]);
    expect(container.querySelector("#todo-1")).toBeNull();
    expect(container.querySelector("#todo-2")).toBe(secondLi);

    unmount();
    expect(cleanedIds).toEqual([1, 2]);
  });

  it.skip("重排列表时复用节点与输入框内容、更新 index()，且静止行跳过 DOM 移动保持焦点", () => {
    const container = createElement("div");
    document.body.appendChild(container);
    const [items, setItems] = createSignal([
      { id: 1, label: "A" },
      { id: 2, label: "B" },
      { id: 3, label: "C" },
    ]);
    const rowCreates = vi.fn();

    const unmount = render(
      () => (
        <ul>
          <For each={items} getKey={(item) => item.id}>
            {(item, index) => {
              rowCreates(item().id);
              return (
                <li id={`row-${item().id}`}>
                  <span class="idx">{() => index()}</span>
                  <span class="label">{() => item().label}</span>
                  <input id={`input-${item().id}`} type="text" />
                </li>
              );
            }}
          </For>
        </ul>
      ),
      container,
    );

    try {
      const rowA = container.querySelector<HTMLLIElement>("#row-1")!;
      const rowB = container.querySelector<HTMLLIElement>("#row-2")!;
      const inputA = container.querySelector<HTMLInputElement>("#input-1")!;
      const inputB = container.querySelector<HTMLInputElement>("#input-2")!;

      inputA.value = "保留在首行";
      inputB.value = "跟着 B 移动";
      inputA.focus();
      expect(document.activeElement).toBe(inputA);

      // 交换后两项 [A, B, C] -> [A, C, B]：首行 A 静止不移动，焦点必须保持在 inputA。
      const [a, b, c] = items();
      setItems([a!, c!, b!]);
      expect(container.querySelector("#row-1")).toBe(rowA);
      expect(document.activeElement).toBe(inputA);
      expect(rowA.querySelector(".idx")?.textContent).toBe("0");
      expect(rowB.querySelector(".idx")?.textContent).toBe("2");
      expect(inputB.value).toBe("跟着 B 移动");

      // 反转全部项 [A, C, B] -> [B, C, A]：仍复用全部旧行且输入值随原行移动。
      setItems([...items()].reverse());
      expect(rowCreates).toHaveBeenCalledTimes(3);
      expect(Array.from(container.querySelectorAll("li")).map((el) => el.id)).toEqual([
        "row-2",
        "row-3",
        "row-1",
      ]);
      expect(rowA.querySelector(".idx")?.textContent).toBe("2");
      expect(rowB.querySelector(".idx")?.textContent).toBe("0");
      expect(inputA.value).toBe("保留在首行");
      expect(inputB.value).toBe("跟着 B 移动");
    } finally {
      unmount();
      container.remove();
    }
  });

  it.skip("不传 getKey 时默认按元素本身复用，并兼容数组中的重复值", () => {
    const container = createElement("div");
    const [tags, setTags] = createSignal(["a", "b", "a"]);
    const creates = vi.fn();

    const unmount = render(
      () => (
        <div>
          <For each={tags}>
            {(tag, index) => {
              creates();
              return (
                <span>
                  {() => tag()}:{() => index()}
                </span>
              );
            }}
          </For>
        </div>
      ),
      container,
    );

    const [firstA, itemB, secondA] = Array.from(container.querySelectorAll("span"));
    expect(container.textContent).toBe("a:0b:1a:2");
    expect(creates).toHaveBeenCalledTimes(3);

    // 调整为 ["a", "a", "b"]：两份 "a" 按原出现顺序配对复用，不创建任何新节点。
    setTags(["a", "a", "b"]);
    expect(creates).toHaveBeenCalledTimes(3);
    expect(Array.from(container.querySelectorAll("span"))).toEqual([firstA, secondA, itemB]);
    expect(container.textContent).toBe("a:0a:1b:2");

    unmount();
  });

  it.skip("空列表与非空列表切换时懒挂载并正确清理 fallback", () => {
    const container = createElement("div");
    const [items, setItems] = createSignal<string[]>([]);
    const fallbackMount = vi.fn();
    const fallbackCleanup = vi.fn();

    const unmount = render(
      () => (
        <div>
          <For
            each={items}
            fallback={() => {
              fallbackMount();
              onCleanup(fallbackCleanup);
              return <p class="empty">暂无任务</p>;
            }}
          >
            {(item) => <p class="row">{() => item()}</p>}
          </For>
        </div>
      ),
      container,
    );

    expect(container.querySelector(".empty")?.textContent).toBe("暂无任务");
    expect(fallbackMount).toHaveBeenCalledTimes(1);

    // 连续写入空数组不应销毁重建 fallback。
    setItems([]);
    expect(fallbackMount).toHaveBeenCalledTimes(1);
    expect(fallbackCleanup).toHaveBeenCalledTimes(0);

    // 变为非空后卸载 fallback 并渲染行；再次清空时重新挂载 fallback。
    setItems(["第一条"]);
    expect(fallbackCleanup).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".empty")).toBeNull();
    expect(container.querySelector(".row")?.textContent).toBe("第一条");

    setItems([]);
    expect(fallbackMount).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".empty")?.textContent).toBe("暂无任务");

    unmount();
    expect(fallbackCleanup).toHaveBeenCalledTimes(2);
  });

  it.skip("行内嵌套 <Show> 切换分支后，重排与删除仍能完整移动和清理当前行区间", () => {
    const container = createElement("div");
    const [items, setItems] = createSignal([
      { id: 1, label: "一" },
      { id: 2, label: "二" },
    ]);
    const [editingId, setEditingId] = createSignal<number | null>(null);
    const editCleanup = vi.fn();

    const unmount = render(
      () => (
        <div>
          <For each={items} getKey={(item) => item.id}>
            {(item) => (
              <Show
                when={() => editingId() === item().id}
                fallback={() => <span class="view">查看:{() => item().label}</span>}
              >
                {() => {
                  onCleanup(editCleanup);
                  return <span class="edit">编辑:{() => item().label}</span>;
                }}
              </Show>
            )}
          </For>
        </div>
      ),
      container,
    );

    expect(container.textContent).toBe("查看:一查看:二");

    // 第 1 行切入编辑态后反转顺序，再删除第 1 行：动态替换后的编辑节点必须跟着移动并被完整清理。
    setEditingId(1);
    expect(container.textContent).toBe("编辑:一查看:二");

    setItems([...items()].reverse());
    expect(container.textContent).toBe("查看:二编辑:一");
    expect(editCleanup).toHaveBeenCalledTimes(0);

    setItems(items().filter((item) => item.id !== 1));
    expect(container.textContent).toBe("查看:二");
    expect(editCleanup).toHaveBeenCalledTimes(1);

    unmount();
  });

  it.skip("新行工厂中途抛错时回滚本轮已建新行且不改动已有旧行", () => {
    const container = createElement("div");
    const [items, setItems] = createSignal([{ id: 1, label: "旧行" }]);
    const newRowCleanup = vi.fn();
    const oldRowEffect = vi.fn();

    const unmount = render(
      () => (
        <ul>
          <For each={items} getKey={(item) => item.id}>
            {(item) => {
              if (item().id === 3) {
                throw new Error("row 3 boom");
              }
              if (item().id === 2) {
                onCleanup(newRowCleanup);
              }
              createEffect(() => {
                if (item().id === 1) {
                  oldRowEffect(item().label);
                }
              });
              return <li>{() => item().label}</li>;
            }}
          </For>
        </ul>
      ),
      container,
    );

    expect(container.textContent).toBe("旧行");
    expect(oldRowEffect).toHaveBeenCalledTimes(1);

    // 本轮包含更新旧行(1)、成功新建行(2)和抛错行(3)：3 抛错后必须先清理 2，且 1 的旧文本不被半截改写。
    expect(() =>
      setItems([
        { id: 1, label: "不应生效的新文案" },
        { id: 2, label: "临时新行" },
        { id: 3, label: "炸弹行" },
      ]),
    ).toThrow("row 3 boom");

    expect(newRowCleanup).toHaveBeenCalledTimes(1);
    expect(oldRowEffect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("旧行");

    unmount();
  });

  it.skip("<For> 直接作为 render 根节点从空列表增行并卸载后，不残留任何锚点与节点", () => {
    const container = createElement("div");
    const sibling = createElement("span", {}, [createText("容器兄弟")]);
    container.appendChild(sibling);

    const [items, setItems] = createSignal<string[]>([]);
    const rowCleanup = vi.fn();

    const unmount = render(
      () => (
        <For each={items} fallback={() => <p>空</p>}>
          {(item) => {
            onCleanup(rowCleanup);
            return <p>{() => item()}</p>;
          }}
        </For>
      ),
      container,
    );

    expect(container.textContent).toBe("容器兄弟空");

    setItems(["甲", "乙"]);
    expect(container.textContent).toBe("容器兄弟甲乙");

    // 连续卸载两次：所有行、行锚点与外层锚点都必须移除干净，只留下容器原有兄弟节点。
    unmount();
    unmount();

    expect(rowCleanup).toHaveBeenCalledTimes(2);
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild).toBe(sibling);
  });
});
