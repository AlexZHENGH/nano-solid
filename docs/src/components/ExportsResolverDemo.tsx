import { For, createSignal } from "solid-js";

/** 第十章包导出条件解析演示组件的输入属性。 */
export type ExportsResolverDemoProps = {
  /** 演示区域的无障碍名称。 */
  label?: string;
};

/** 模拟消费环境：外部项目运行时、外部项目类型检查、仓内 Vite HMR、仓内 TypeScript 检查。 */
type ConsumerEnv = "external-runtime" | "external-types" | "repo-vite" | "repo-tsc";

/** 可点击测试的导入路径条目。 */
type ImportProbe = {
  specifier: string;
  subpath: string;
  purpose: string;
  targets: Record<ConsumerEnv, { ok: boolean; matchedCondition: string; resolvedPath: string }>;
};

const ENVIRONMENTS: Array<{ id: ConsumerEnv; label: string; conditions: string }> = [
  {
    id: "external-runtime",
    label: "外部项目（Node / Vite 运行）",
    conditions: '["import", "default"]',
  },
  {
    id: "external-types",
    label: "外部项目（tsc 类型检查）",
    conditions: '["types", "import", "default"]',
  },
  {
    id: "repo-vite",
    label: "本仓开发（Vite HMR）",
    conditions: '["nano-solid-source", "import", "default"]',
  },
  {
    id: "repo-tsc",
    label: "本仓检查（tsconfig customConditions）",
    conditions: '["nano-solid-source", "types", "import", "default"]',
  },
];

const PROBES: ImportProbe[] = [
  {
    specifier: 'import { createSignal, For, Show, render } from "nano-solid";',
    subpath: ".",
    purpose: "框架公共 API 入口",
    targets: {
      "external-runtime": {
        ok: true,
        matchedCondition: "default",
        resolvedPath: "./dist/index.js",
      },
      "external-types": { ok: true, matchedCondition: "types", resolvedPath: "./dist/index.d.ts" },
      "repo-vite": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/index.ts",
      },
      "repo-tsc": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/index.ts",
      },
    },
  },
  {
    specifier: 'import { jsx, jsxs } from "nano-solid/jsx-runtime";',
    subpath: "./jsx-runtime",
    purpose: "TypeScript / Vite 自动 JSX 回退入口",
    targets: {
      "external-runtime": {
        ok: true,
        matchedCondition: "default",
        resolvedPath: "./dist/jsx-runtime.js",
      },
      "external-types": {
        ok: true,
        matchedCondition: "types",
        resolvedPath: "./dist/jsx-runtime.d.ts",
      },
      "repo-vite": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/jsx-runtime.ts",
      },
      "repo-tsc": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/jsx-runtime.ts",
      },
    },
  },
  {
    specifier: 'import { bindProperty, onCleanup } from "nano-solid/compiler-runtime";',
    subpath: "./compiler-runtime",
    purpose: "JSX 编译器自动注入的轻量运行时原语",
    targets: {
      "external-runtime": {
        ok: true,
        matchedCondition: "default",
        resolvedPath: "./dist/compiler-runtime.js",
      },
      "external-types": {
        ok: true,
        matchedCondition: "types",
        resolvedPath: "./dist/compiler-runtime.d.ts",
      },
      "repo-vite": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/compiler-runtime.ts",
      },
      "repo-tsc": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/compiler-runtime.ts",
      },
    },
  },
  {
    specifier: 'import { nanoSolid } from "nano-solid/vite";',
    subpath: "./vite",
    purpose: "Vite 编译器插件公共入口",
    targets: {
      "external-runtime": { ok: true, matchedCondition: "default", resolvedPath: "./dist/vite.js" },
      "external-types": { ok: true, matchedCondition: "types", resolvedPath: "./dist/vite.d.ts" },
      "repo-vite": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/vite.ts",
      },
      "repo-tsc": {
        ok: true,
        matchedCondition: "nano-solid-source",
        resolvedPath: "./src/vite.ts",
      },
    },
  },
  {
    specifier: 'import { createSignal } from "nano-solid/dist/reactive.js";',
    subpath: "./dist/reactive.js",
    purpose: "未声明在 exports 中的内部实现深层导入",
    targets: {
      "external-runtime": {
        ok: false,
        matchedCondition: "未命中 exports 白名单",
        resolvedPath: "ERR_PACKAGE_PATH_NOT_EXPORTED（Node / Vite 直接拦截）",
      },
      "external-types": {
        ok: false,
        matchedCondition: "未命中 exports 白名单",
        resolvedPath: "TS2307: Cannot find module（TypeScript 直接报错）",
      },
      "repo-vite": {
        ok: false,
        matchedCondition: "未命中 exports 白名单",
        resolvedPath: "ERR_PACKAGE_PATH_NOT_EXPORTED（仓内同样受白名单保护）",
      },
      "repo-tsc": {
        ok: false,
        matchedCondition: "未命中 exports 白名单",
        resolvedPath: "TS2307: Cannot find module（仓内同样禁止深层穿越）",
      },
    },
  },
];

/**
 * 第十章总览交互演示：切换消费环境与导入子路径，直观展示 package.json 条件 exports 与仓内自定义条件如何兼顾“零构建 HMR”与“外部消费 dist”。
 *
 * @param props 无障碍标签配置。
 * @returns 带环境切换、子路径选择与解析结果的交互卡片。
 */
export default function ExportsResolverDemo(props: ExportsResolverDemoProps) {
  const [envId, setEnvId] = createSignal<ConsumerEnv>("external-runtime");
  const [probeIndex, setProbeIndex] = createSignal(0);

  const currentEnv = () => ENVIRONMENTS.find((item) => item.id === envId()) ?? ENVIRONMENTS[0]!;
  const currentProbe = () => PROBES[probeIndex()] ?? PROBES[0]!;
  const resolution = () => currentProbe().targets[envId()];

  return (
    <section
      class="ns-card dom-demo"
      aria-label={props.label ?? "第十章预期效果：package.json 条件导出解析"}
    >
      {/* 1. 顶部标题与消费环境切换栏。 */}
      <div class="ns-card-header">
        <h3 class="ns-card-title">条件导出解析器（exports）</h3>
        <span class={resolution().ok ? "ns-badge" : "ns-badge ns-badge-muted"}>
          {resolution().ok ? `命中 ${resolution().matchedCondition}` : "拦截越界导入"}
        </span>
      </div>

      {/* 2. 环境选择按钮组。 */}
      <div class="compiler-demo-panel">
        <div class="compiler-demo-label">
          <span>1. 选择解析环境</span>
          <code>conditions = {currentEnv().conditions}</code>
        </div>
        <div class="ns-actions">
          <For each={ENVIRONMENTS}>
            {(env) => (
              <button
                type="button"
                class={envId() === env.id ? "ns-btn ns-btn-sm ns-btn-active" : "ns-btn ns-btn-sm"}
                onClick={() => setEnvId(env.id)}
              >
                {env.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* 3. 导入子路径选择按钮组。 */}
      <div class="compiler-demo-panel">
        <div class="compiler-demo-label">
          <span>2. 选择要解析的导入路径</span>
          <span>{currentProbe().purpose}</span>
        </div>
        <div class="ns-actions">
          <For each={PROBES}>
            {(probe, index) => (
              <button
                type="button"
                class={
                  probeIndex() === index() ? "ns-btn ns-btn-sm ns-btn-active" : "ns-btn ns-btn-sm"
                }
                onClick={() => setProbeIndex(index())}
              >
                {probe.subpath}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* 4. 展示导入代码与最终命中的文件或报错（与上方选项组保持统一垂直间距）。 */}
      <div class="compiler-demo-panel">
        <div class="compiler-demo-label">
          <span>3. 解析结果</span>
          <code>{resolution().matchedCondition}</code>
        </div>
        <pre class="compiler-demo-pre">
          <code>{`${currentProbe().specifier}\n\n// 解析结果（匹配条件：${resolution().matchedCondition}）\n// -> ${resolution().resolvedPath}`}</code>
        </pre>
      </div>
    </section>
  );
}
