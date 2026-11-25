// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render } from "#nano-solid";
import { App } from "./App.tsx";

describe("Todo 示例应用", () => {
  it.skip("渲染初始待办列表与统计，添加新任务后清空输入框并重新聚焦", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const unmount = render(() => <App />, container);

    try {
      expect(container.querySelector("#remaining-badge")?.textContent).toBe("剩余 2 项");
      expect(container.querySelectorAll("li").length).toBe(3);
      expect(container.querySelector("#todo-stats")?.textContent).toContain("共 3 项");
      expect(container.querySelector("#todo-stats")?.textContent).toContain("已完成 1 项");

      const input = container.querySelector<HTMLInputElement>("#todo-input")!;
      const addButton = container.querySelector<HTMLButtonElement>("#add-todo")!;
      expect(addButton.disabled).toBe(true);

      input.value = "  写完 Todo 测试  ";
      input.dispatchEvent(new Event("input"));
      expect(addButton.disabled).toBe(false);

      addButton.click();
      expect(container.querySelectorAll("li").length).toBe(4);
      expect(container.querySelector("#todo-4")?.textContent).toContain("写完 Todo 测试");
      expect(container.querySelector("#remaining-badge")?.textContent).toBe("剩余 3 项");
      expect(input.value).toBe("");
      expect(addButton.disabled).toBe(true);
      expect(document.activeElement).toBe(input);
    } finally {
      unmount();
      container.remove();
    }
  });

  it.skip("勾选任务完成时复用同一个 li 节点并同步更新剩余未完成统计", () => {
    const container = document.createElement("div");
    const unmount = render(() => <App />, container);

    const secondLi = container.querySelector<HTMLLIElement>("#todo-2")!;
    const checkbox = secondLi.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    // 不可变更新第 2 条任务后，必须复用同一个 <li> DOM 节点并更新完成样式与统计。
    expect(container.querySelector("#todo-2")).toBe(secondLi);
    expect(secondLi.querySelector(".ns-todo-text")?.className).toContain("ns-todo-text-done");
    expect(container.querySelector("#remaining-badge")?.textContent).toBe("剩余 1 项");

    unmount();
  });

  it.skip("在全部、未完成、已完成筛选之间切换时通过 createMemo 同步列表", () => {
    const container = document.createElement("div");
    const unmount = render(() => <App />, container);

    const filterAll = container.querySelector<HTMLButtonElement>("#filter-all")!;
    const filterActive = container.querySelector<HTMLButtonElement>("#filter-active")!;
    const filterCompleted = container.querySelector<HTMLButtonElement>("#filter-completed")!;

    filterActive.click();
    expect(filterActive.className).toContain("ns-btn-active");
    expect(Array.from(container.querySelectorAll("li")).map((el) => el.id)).toEqual([
      "todo-2",
      "todo-3",
    ]);

    filterCompleted.click();
    expect(Array.from(container.querySelectorAll("li")).map((el) => el.id)).toEqual(["todo-1"]);

    filterAll.click();
    expect(container.querySelectorAll("li").length).toBe(3);

    unmount();
  });

  it.skip("支持通过行内编辑保存或取消修改，以及删除任务后展示空列表 fallback", () => {
    const container = document.createElement("div");
    const unmount = render(() => <App />, container);

    const secondLi = container.querySelector<HTMLLIElement>("#todo-2")!;
    const editBtn = Array.from(secondLi.querySelectorAll("button")).find(
      (btn) => btn.textContent === "编辑",
    )!;
    editBtn.click();

    // 进入编辑态后修改文本并点击取消：应恢复原内容。
    const editInput = secondLi.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(editInput.value).toBe("实现按 key 复用的 For 列表");
    editInput.value = "不会保存的文案";
    editInput.dispatchEvent(new Event("input"));
    const cancelBtn = Array.from(secondLi.querySelectorAll("button")).find(
      (btn) => btn.textContent === "取消",
    )!;
    cancelBtn.click();
    expect(secondLi.querySelector(".ns-todo-text")?.textContent).toBe("实现按 key 复用的 For 列表");

    // 再次编辑并保存：应更新列表项内容且仍复用同一个 <li>。
    Array.from(secondLi.querySelectorAll("button"))
      .find((btn) => btn.textContent === "编辑")!
      .click();
    const editInput2 = secondLi.querySelector<HTMLInputElement>('input[type="text"]')!;
    editInput2.value = "已更新的任务标题";
    editInput2.dispatchEvent(new Event("input"));
    Array.from(secondLi.querySelectorAll("button"))
      .find((btn) => btn.textContent === "保存")!
      .click();
    expect(container.querySelector("#todo-2")).toBe(secondLi);
    expect(secondLi.querySelector(".ns-todo-text")?.textContent).toBe("已更新的任务标题");

    // 依次删除全部 3 条任务，确认展示空列表 fallback 与“全部完成”徽章。
    for (let i = 0; i < 3; i += 1) {
      const deleteBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.textContent === "删除",
      )!;
      deleteBtn.click();
    }
    expect(container.querySelectorAll("li").length).toBe(0);
    expect(container.querySelector(".ns-empty")?.textContent).toContain("没有待办事项");
    expect(container.querySelector("#remaining-badge")?.textContent).toBe("全部完成");

    unmount();
  });

  it.skip("卸载 Todo 应用后清空容器", () => {
    const container = document.createElement("div");
    const unmount = render(() => <App />, container);

    expect(container.childNodes.length).toBe(1);
    unmount();
    expect(container.childNodes.length).toBe(0);
  });
});
