// @vitest-environment jsdom

import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";
import * as compilerRuntime from "../compiler-runtime.ts";
import { render } from "../dom.ts";
import { jsx, jsxs } from "../jsx-runtime.ts";
import { createSignal } from "../reactive.ts";
import { nanoSolid } from "./vite-plugin.ts";

/** 直接调用 Vite 插件的 transform 钩子，兼容函数形态与对象钩子形态。 */
function invokePluginTransform(plugin: Plugin, code: string, id: string) {
  const hook = plugin.transform;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  if (!handler) {
    throw new Error("Plugin transform hook is missing");
  }
  return handler.call({} as never, code, id);
}

/** 将插件编译产出的代码绑定到真实的 compilerRuntime 后求值，用于对比编译路径与运行时路径。 */
function evaluatePluginOutput<T>(code: string, bindings: Record<string, unknown> = {}): T {
  const executable = code.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["'];?/gm,
    (_match, specifiers: string) => {
      const destructured = specifiers
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.replace(/\s+as\s+/, ": "))
        .join(", ");
      return `const { ${destructured} } = __compilerRuntime;`;
    },
  );

  const argNames = ["__compilerRuntime", ...Object.keys(bindings)];
  const argValues = [compilerRuntime, ...Object.values(bindings)];
  const runner = new Function(...argNames, `${executable}\nreturn __result;`) as (
    ...args: unknown[]
  ) => T;
  return runner(...argValues);
}

describe("编译路径与 jsx-runtime 回退路径双路径等价性", () => {
  it("开启插件编译路径与关闭插件 jsx-runtime 回退路径在 DOM、事件、受控输入、ref 与卸载上完全等价", () => {
    const plugin = nanoSolid();
    const transformed = invokePluginTransform(
      plugin,
      `
        const __result = (deps) => (
          <section class="ns-card">
            <input
              id="box"
              type="text"
              ref={(el) => deps.setRef(el)}
              value={() => deps.draft()}
              onInput={(e) => deps.setDraft(e.currentTarget.value)}
            />
            <button
              id="go"
              type="button"
              class={() => (deps.draft().length > 0 ? "ns-btn active" : "ns-btn")}
              disabled={() => deps.draft().length === 0}
              onClick={deps.onSubmit}
            >
              提交：{() => deps.draft()}（初始：{deps.draft()}）
            </button>
          </section>
        );
      `,
      "/repo/src/Parity.tsx",
    );
    expect(transformed).not.toBeNull();
    const compiledCode =
      transformed && typeof transformed === "object" && "code" in transformed
        ? transformed.code
        : "";

    type Deps = {
      draft: () => string;
      setDraft: (next: string) => void;
      setRef: (el: HTMLInputElement) => void;
      onSubmit: () => void;
    };
    const compiledFactory = evaluatePluginOutput<(deps: Deps) => Node>(compiledCode);

    // 运行同一套交互脚本，对比编译路径与纯 jsx-runtime 路径的每一步观察结果。
    function runScenario(createView: (deps: Deps) => Node) {
      const [draft, setDraft] = createSignal("");
      let capturedRef: HTMLInputElement | undefined;
      let submits = 0;

      const container = document.createElement("div");
      const unmount = render(
        () =>
          createView({
            draft,
            setDraft,
            setRef: (el) => {
              capturedRef = el;
            },
            onSubmit: () => {
              submits += 1;
            },
          }),
        container,
      );

      const input = container.querySelector<HTMLInputElement>("#box")!;
      const button = container.querySelector<HTMLButtonElement>("#go")!;
      const initial = {
        html: container.innerHTML,
        disabled: button.disabled,
        refMatched: capturedRef === input,
      };

      input.value = "hello";
      input.dispatchEvent(new Event("input"));
      button.click();
      const afterInput = {
        html: container.innerHTML,
        disabled: button.disabled,
        className: button.className,
        text: button.textContent,
        submits,
      };

      unmount();
      button.click();
      setDraft("after-unmount");
      const afterUnmount = {
        childCount: container.childNodes.length,
        submits,
        staleButtonText: button.textContent,
      };

      return { initial, afterInput, afterUnmount };
    }

    const compiledTrace = runScenario(compiledFactory);
    const runtimeTrace = runScenario((deps) =>
      jsxs("section", {
        class: "ns-card",
        children: [
          jsx("input", {
            id: "box",
            type: "text",
            ref: (el) => deps.setRef(el),
            value: () => deps.draft(),
            onInput: (e) => deps.setDraft(e.currentTarget.value),
          }),
          jsxs("button", {
            id: "go",
            type: "button",
            class: () => (deps.draft().length > 0 ? "ns-btn active" : "ns-btn"),
            disabled: () => deps.draft().length === 0,
            onClick: deps.onSubmit,
            children: ["提交：", () => deps.draft(), "（初始：", deps.draft(), "）"],
          }),
        ],
      }),
    );

    expect(compiledTrace).toEqual(runtimeTrace);
  });
});
