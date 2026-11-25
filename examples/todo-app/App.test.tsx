// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORAGE_KEY } from "./storage.ts";
import { createMemoryTodoStorage } from "./test-support/memory-todo-storage.ts";
import { mountTodoApp } from "./test-support/mount-todo-app.tsx";

describe("Todo 示例应用", () => {
  afterEach(() => {
    window.localStorage.removeItem(DEFAULT_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it("渲染初始待办列表与统计，添加新任务后清空输入框并重新聚焦", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const unmount = mountTodoApp(container);

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

  it("勾选任务完成时复用同一个 li 节点并同步更新剩余未完成统计", () => {
    const container = document.createElement("div");
    const unmount = mountTodoApp(container);

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

  it("在全部、未完成、已完成筛选之间切换时通过 createMemo 同步列表", () => {
    const container = document.createElement("div");
    const unmount = mountTodoApp(container);

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

  it("支持通过行内编辑保存或取消修改，以及删除任务后展示空列表 fallback", () => {
    const container = document.createElement("div");
    const unmount = mountTodoApp(container);

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

  it("卸载 Todo 应用后清空容器", () => {
    const container = document.createElement("div");
    const unmount = mountTodoApp(container);

    expect(container.childNodes.length).toBe(1);
    unmount();
    expect(container.childNodes.length).toBe(0);
  });

  it("通过惰性 createMemo 按需展开已完成任务明细并在展开期间保持同步", () => {
    const container = document.createElement("div");
    const unmount = mountTodoApp(container);

    const toggleButton = container.querySelector<HTMLButtonElement>("#toggle-completed-details")!;
    expect(toggleButton.textContent).toBe("查看已完成明细");
    expect(container.querySelector("#completed-details")).toBeNull();

    // 折叠状态下先勾选第 2 条任务为已完成，展开后应一次算出最新明细。
    const secondCheckbox = container
      .querySelector<HTMLLIElement>("#todo-2")!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    secondCheckbox.checked = true;
    secondCheckbox.dispatchEvent(new Event("change"));

    toggleButton.click();
    expect(toggleButton.textContent).toBe("收起已完成明细");
    expect(container.querySelector("#completed-details")?.textContent).toContain(
      "实现 createMemo 派生缓存、实现按 key 复用的 For 列表",
    );

    // 展开期间取消勾选第 1 条任务，明细应同步更新。
    const firstCheckbox = container
      .querySelector<HTMLLIElement>("#todo-1")!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    firstCheckbox.checked = false;
    firstCheckbox.dispatchEvent(new Event("change"));
    expect(container.querySelector("#completed-details")?.textContent).toBe(
      "已完成明细：实现按 key 复用的 For 列表",
    );

    toggleButton.click();
    expect(container.querySelector("#completed-details")).toBeNull();
    unmount();
  });

  it("通过 localStorage 持久化新增与勾选结果，卸载并重新挂载后完整恢复", () => {
    const firstContainer = document.createElement("div");
    const unmountFirst = mountTodoApp(firstContainer);

    const input = firstContainer.querySelector<HTMLInputElement>("#todo-input")!;
    input.value = "刷新后仍保留的任务";
    input.dispatchEvent(new Event("input"));
    firstContainer.querySelector<HTMLButtonElement>("#add-todo")!.click();

    const newCheckbox = firstContainer
      .querySelector<HTMLLIElement>("#todo-4")!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    newCheckbox.checked = true;
    newCheckbox.dispatchEvent(new Event("change"));
    unmountFirst();

    // 模拟刷新页面：在全新的容器中重新挂载，验证新任务与完成状态完整恢复。
    const secondContainer = document.createElement("div");
    const unmountSecond = mountTodoApp(secondContainer);
    expect(secondContainer.querySelectorAll("li").length).toBe(4);
    expect(secondContainer.querySelector("#todo-4")?.textContent).toContain("刷新后仍保留的任务");
    expect(
      secondContainer
        .querySelector<HTMLLIElement>("#todo-4")!
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    ).toBe(true);
    unmountSecond();
  });

  it("删除全部任务后存储为空数组 []，重新挂载时保持空列表而不回退默认示例", () => {
    const firstContainer = document.createElement("div");
    const unmountFirst = mountTodoApp(firstContainer);

    for (let i = 0; i < 3; i += 1) {
      const deleteBtn = Array.from(firstContainer.querySelectorAll("button")).find(
        (btn) => btn.textContent === "删除",
      )!;
      deleteBtn.click();
    }
    unmountFirst();

    expect(window.localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe("[]");

    const secondContainer = document.createElement("div");
    const unmountSecond = mountTodoApp(secondContainer);
    expect(secondContainer.querySelectorAll("li").length).toBe(0);
    expect(secondContainer.querySelector(".ns-empty")?.textContent).toContain("没有待办事项");
    expect(secondContainer.querySelector("#remaining-badge")?.textContent).toBe("全部完成");
    unmountSecond();
  });

  it("恢复稀疏 ID 的历史任务后，新增任务从最大 ID 下一位递增避免 ID 冲突", () => {
    window.localStorage.setItem(
      DEFAULT_STORAGE_KEY,
      JSON.stringify([
        { id: 2, text: "历史任务 A", completed: false },
        { id: 10, text: "历史任务 B", completed: true },
      ]),
    );
    const container = document.createElement("div");
    const unmount = mountTodoApp(container);

    const input = container.querySelector<HTMLInputElement>("#todo-input")!;
    input.value = "新的高编号任务";
    input.dispatchEvent(new Event("input"));
    container.querySelector<HTMLButtonElement>("#add-todo")!.click();

    // 现有最大 id 是 10，新增任务必须拿到 id=11 而不是 3。
    expect(container.querySelector("#todo-11")?.textContent).toContain("新的高编号任务");

    unmount();
  });

  it("仅挂载、切换筛选或输入草稿时不会无谓写入 localStorage", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const container = document.createElement("div");
    const unmount = mountTodoApp(container);

    // 首次挂载建立订阅不应立刻覆盖存储。
    expect(setItemSpy).toHaveBeenCalledTimes(0);

    // 切换筛选与输入草稿都不改变 todos，不应触发持久化写入。
    container.querySelector<HTMLButtonElement>("#filter-active")!.click();
    const input = container.querySelector<HTMLInputElement>("#todo-input")!;
    input.value = "仅在输入框里的文字";
    input.dispatchEvent(new Event("input"));
    expect(setItemSpy).toHaveBeenCalledTimes(0);

    // 真正添加任务后才写入一次。
    container.querySelector<HTMLButtonElement>("#add-todo")!.click();
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("注入损坏记录或坏 JSON 的内存存储时展示 #load-warning 警告条，且启动时不覆写原存储", () => {
    // 1. 部分损坏与重复 ID：救回有效任务并显示跳过条数。
    const partialStorage = createMemoryTodoStorage({
      initialRaw: JSON.stringify([
        { id: 1, text: "保住的任务 A", completed: true },
        { id: -3, text: "非法负数 ID", completed: false },
        { id: 1, text: "重复 ID 1", completed: false },
        { id: 4, text: "保住的任务 B", completed: false },
      ]),
    });
    const partialContainer = document.createElement("div");
    const unmountPartial = mountTodoApp(partialContainer, partialStorage);

    expect(Array.from(partialContainer.querySelectorAll("li")).map((el) => el.id)).toEqual([
      "todo-1",
      "todo-4",
    ]);
    expect(partialContainer.querySelector("#load-warning")?.textContent).toContain("跳过 2 条");
    expect(partialContainer.querySelector("#save-error")).toBeNull();
    expect(partialStorage.getWriteCount()).toBe(0);
    unmountPartial();

    // 2. 坏 JSON：回退默认任务并保护原存储不被覆写。
    const brokenStorage = createMemoryTodoStorage({ initialRaw: "{corrupted-json" });
    const brokenContainer = document.createElement("div");
    const unmountBroken = mountTodoApp(brokenContainer, brokenStorage);

    expect(brokenContainer.querySelectorAll("li").length).toBe(3);
    expect(brokenContainer.querySelector("#load-warning")?.textContent).toContain(
      "读取本地存储失败",
    );
    expect(brokenStorage.getWriteCount()).toBe(0);
    expect(brokenStorage.getRaw()).toBe("{corrupted-json");
    unmountBroken();
  });

  it("写入抛错时保留页面新任务并显示 #save-error 提示，存储恢复后再次修改自动保存并撤下提示", () => {
    const storage = createMemoryTodoStorage({ failWrite: true });
    const container = document.createElement("div");
    const unmount = mountTodoApp(container, storage);

    const input = container.querySelector<HTMLInputElement>("#todo-input")!;
    input.value = "离线写入失败任务";
    input.dispatchEvent(new Event("input"));
    container.querySelector<HTMLButtonElement>("#add-todo")!.click();

    // 写入抛错时不能把用户刚加的任务丢掉，并展示红色保存失败提示。
    expect(container.querySelector("#todo-4")?.textContent).toContain("离线写入失败任务");
    expect(container.querySelector("#save-error")?.textContent).toContain("保存失败");

    // 恢复存储后，下一次修改应成功保存并自动撤下保存失败提示。
    storage.setFailWrite(false);
    const checkbox = container
      .querySelector<HTMLLIElement>("#todo-4")!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    expect(container.querySelector("#save-error")).toBeNull();
    expect(storage.getRaw()).toContain("离线写入失败任务");

    unmount();
  });
});
