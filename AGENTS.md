# AGENTS.md

本仓库是用 TypeScript 从零实现细粒度响应式前端框架 `nano-solid` 的中文课程项目，写作风格参考 [Build Your Own Text Editor](https://viewsourcecode.org/snaptoken/kilo/)（Kilo）。在这里协作或编写新课时，请遵守以下约定。

## 环境与常用命令

- 常用命令（均在仓库根目录运行）：
  - `pnpm dev`：启动当前快照的示例
  - `pnpm build`：按当前快照的构建配置生成产物
  - `pnpm test:run`：用 Vitest 跑一遍测试
  - `pnpm format` / `pnpm check`：格式化代码（oxfmt），以及依次执行 `format:check`、`lint`（oxlint）与 `typecheck`（`tsc --noEmit`）
  - `pnpm docs:dev` / `pnpm docs:build`：预览或静态构建 `docs/` 课程文档站
  - `pnpm tags:check` / `pnpm tags:refresh`：检查当前快照的标签，或在 `main` 上刷新本地课程标签
- 本项目不设置 pre-commit hook，但每次提交前必须先运行 `pnpm format && pnpm check && pnpm test:run` 确保通过（涉及文档改动时再运行 `pnpm docs:build`）。
- `tsconfig.json` 为编辑器和 `pnpm typecheck` 提供类型检查范围。需要生成库或入口产物的快照用 `tsconfig.build.json` 指定参与编译的源码。

## Git 历史与快照约定

- 修改旧提交、重放历史和迁移标签的步骤见 [README 的“更新课程内容”](README.md#更新课程内容)。
- 从第一课起就需要的配置放进 `init`，课程文档站的部署配置放进紧随其后的 `ci`。课程中途引入的配置放进首次使用它的提交。
- **一次打磨一课**：从 `main` 开 `draft/lesson-<编号>`，整理并验证后快进合并。
  - 每章开头先放单独的 `chapter(N)` 总览提交（不打 learn/solution 标签）。
  - 每个小节对应一对提交与标签：`learn(N.M)`（标签 `N.M-learn`）与 `solution(N.M)`（标签 `N.M-solution`）。
- **每个快照都必须独立可运行**：打标签或重放提交时，确保每个快照都能独立运行和构建文档。
- **保持 `learn..solution` 的 `src/` diff 干净**：
  - 非 `TODO` 的 JSDoc、意图注释和函数签名在 `learn` 中一步写定，不要在 `solution` 里顺手润色改写。
  - 意图注释和 `// TODO:` 分两行写，解答时只把 `// TODO:` 替换成正式实现，保留上方的意图注释不变。
  - 若 `learn` 中某个参数或变量因尚未实现触发 `oxlint` 的 `no-unused-vars`，不要改名加 `_` 前缀，也不要塞 `void x;`。在声明上一行单独写 `// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行`，解答时删掉这行即可（不要写成行尾 `oxlint-disable-line`，`oxfmt` 会把它折进函数体导致失效）。
- **测试节奏**：前面小节的测试继续保持通过。当前小节在 `learn` 中直接给出完整的导出 API、类型定义和写好的测试用例（用 `it.skip` 跳过），读者去掉 `.skip` 看到失败后再补全实现，`solution` 中只把 `it.skip` 改为 `it` 启用测试。

## 教学结构与文档站约定

- **Kilo 风格、即用即讲**：每课标题下方直接用普通正文自然过渡（承接上一课并说明本课要做什么），不在页头单独渲染灰色 `description` 导语。先让读者运行看到现象，再拆开代码解释原因，最后一步步动手改写并验证。不要提前堆砌未用到的配置项或文档站内部实现（文档站维护说明统一写在 `docs/README.md`）。
- **题目与解答 1:1 对齐**：题目页放 `docs/src/pages/lessons/`，解答正文放 `docs/src/solutions/<slug>.mdx`，通过同页折叠组件 `<LessonSolution slug="..." tag="..." />` 挂载。
- **侧注与统一练习框**：补充背景或配置细节使用 `> [!NOTE]`（也支持 `TIP`、`IMPORTANT`、`WARNING`、`CAUTION`），每课结尾统一使用 `> [!PRACTICE]` 给出练习任务，由本地零依赖插件 `docs/src/plugins/remark-callouts.mjs` 转成 `<aside class="callout ...">`。出题前由正文铺垫清痛点与设计意图，`[!PRACTICE]` 框内只写切分支的 `git switch` 命令、期望达到的现象，以及验证命令（如 `pnpm format && pnpm check && pnpm test:run`）。去掉 `it.skip`、补 `// TODO` 和删除 `oxlint-disable-next-line` 这套通用操作只在第一章讲清，后续各课不再在正文里逐行重复。
- **交互演示组件与共享样式**：演示预期效果时优先用真正的 `solid-js` 驱动。引入 DOM 渲染前的章节，用“代码追加调用 + Console 输出”模拟终端 `console.log`（如 `ReactivityConsoleDemo`、`EffectLifecycleDemo`），行动按钮放代码区上方、全宽 `重置` 按钮放 Console 输出下方，代码框与输出框固定高度、自动滚底且不设点击上限，避免页面抖动。引入 DOM 渲染后，直接演示预期的 HTML 交互效果。文档站与示例应用共用根目录 `styles/tokens.css`（设计变量）和 `styles/ui.css`（无全局副作用的 `.ns-*` 组件类），保证两侧视觉一致且不污染框架库 `src/`。
- **Mermaid 图表**：需要说明依赖图、数据结构或生命周期关系时，直接在 MDX 中使用标准 ` ```mermaid ` 代码块，由 `docs/src/plugins/remark-mermaid.mjs` 与按需加载的本地 `mermaid` 渲染。
- **目录与导航同步**：新增课程页面时，同步更新 `docs/src/pages/index.astro` 的课程目录（目录只放已存在页面的链接，与正文标题保持一致）。页面底部的 `← 上一课 / 下一课 →` 由 `docs/src/layouts/BookLayout.astro` 自动扫描生成，无需手动维护。
- **示例应用位置**：Todo 应用放在 `examples/todo-app`。

## 写作与代码规范

- **中文清晰、简练、不公文化**：像工程师坐在旁边一起敲代码，删掉套话、报告腔和段末多余总结。不使用破折号（`——`、`–`），不滥用分号和装饰性引号；中文引语用中文双引号，英文引语用英文双引号，代码与标识符用反引号。条目开头已自带编号（如 `2.1`、`3.1`）时使用无序列表（`-`），避免出现 `1. 3.1` 这种双重编号。
- **类型声明规范**：默认使用 `type` 定义数据结构与组件 Props；仅在需要声明合并（如全局增强、`JSX.IntrinsicElements`）时使用 `interface`。
- **代码库单向解耦于课程编号**：课程文档（`docs/`）与 Git 标签引用代码演进节点，但代码库本身（`src/`、`examples/`、`tools/`、根目录配置文件与所有测试）只按模块与领域职责编写，禁止在源码、注释或测试标题（`describe` / `it`）中写入章节或小节编号（如 `9.1`、`第十章`、`本节`），也不在测试中反向断言代码是否包含章节字样，避免概念泄露。
- **全仓演示级代码与中文注释**：仓库里的每一份代码都是教学示范的一部分，不仅框架源码（`src/`），运行入口（`src/main.ts`）、示例应用（`examples/**`）以及文档站代码（`docs/src/**`）都必须遵守同一规范。测试名称、注释与 JSDoc 均使用中文；关键函数和类型用 JSDoc 说明职责、参数与返回值；每个有意义的逻辑段（如状态定义、视图拼装、事件绑定、挂载与卸载切换）都写清分段注释，让读者顺着代码就能看懂每段意图。

## 新增课程

从 `main` 切出一个工作分支。以下用 `13.1` 作为编号示例。

```sh
# 在最新的课程快照上开始。
git switch main
git switch -c draft/lesson-13.1
```

开发期间可以随时提交。准备合并时，运行 `git rebase -i main`，把临时提交折叠进它们所属的 `learn(13.1)` 或 `solution(13.1)`。如果是新一章，先保留一笔独立的 `chapter(13)` 总览提交。读者会从题目提交开始练习，所以题目和解答各留一笔。

分别检出题目和解答，按各自的锁文件安装依赖，运行 `pnpm format && pnpm check && pnpm test:run && pnpm docs:build`。确认两个快照都能独立运行后，快进合并，再生成本课的标签。

```sh
# 把 main 快进到本课解答，再按 main 上的课程提交打标签。
git switch main
git merge --ff-only draft/lesson-13.1
pnpm tags:refresh
pnpm tags:check

# 确认标签检查通过后，清理已合并的工作分支。
git branch -d draft/lesson-13.1
```

如果快进合并失败，先把工作分支重放到最新的 `main`，重新验证后再合并。推送时把新标签和 `main` 一起发出去，部署 workflow 会核对标签。
