# nano-solid 课程文档站

`docs/` 是 `nano-solid` 的课程文档站，用 Astro、MDX 和 SolidJS 搭建，作为根目录 pnpm 工作区的一部分随主项目一起装依赖。

## 常用命令

在仓库根目录运行：

```sh
# 启动本地开发服务器，做练习时实时预览课程与解答。
pnpm docs:dev

# 生成静态站点，产物输出到 docs/dist/。
pnpm docs:build
```

## 解答区的三种状态

每课末尾用 `src/components/LessonSolution.astro` 挂载折叠解答。组件接收解答文件名 `slug` 和解答快照的 Git 标签名 `tag`，在 Astro 服务端（Node.js）按下面三种情况展示不同内容：

1. 当前快照已经有 `src/solutions/<slug>.mdx`（比如检出了 `1-solution` 或完整课程版本），直接渲染解答正文，不调用 Git。
2. 还没有解答 MDX，但本地 Git 已经有 `refs/tags/<tag>`（读者在 `1-learn` 上做练习），只给一行干净的 `git switch --detach <tag>`，不把检查标签的 Shell 脚本暴露给初学者。
3. 还没有解答 MDX，本地也没有 `<tag>` 标签（作者正在出题，或学习 skill 刚生成题目、还没生成解答），直接提示解答快照还没生成。等解答提交并打上标签后，在 `pnpm docs:dev` 下刷新页面就会出现切换命令。

### 为什么在 Astro 组件里跑 `git show-ref`

面向读者时，页面上只保留可以直接复制的单行 Git 命令，或者一句明确的等待提示，省去阅读和理解 `git show-ref` 脚本的负担。这门课主要在本地 `git clone` 后配合 `pnpm docs:dev` 阅读，开发模式下每次刷新页面都会重跑组件顶部的服务端代码，新打上的解答标签会立刻生效。

跑 `pnpm docs:build` 做静态构建时，标签检查只在构建那一刻执行一次，结果会写进静态 HTML。在完整课程提交上构建在线站点时，`src/solutions/*.mdx` 已经存在，会直接渲染解答正文，不依赖 `.git` 目录或远端标签。如果单独在题目快照上构建静态页，且当时还没有解答标签或缺少 `.git` 目录，生成的静态页就会停留在等待提示。

## 侧注提示框（Callout）

`src/plugins/remark-callouts.mjs` 是本地写的零依赖 remark 插件，在 `astro.config.mjs` 里挂给 `@astrojs/mdx`。它会把 GitHub 风格的引用块（`> [!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]`、`[!CAUTION]`）以及课程专用的练习框（`> [!PRACTICE]`）转成 `<aside class="callout ...">`，把补充知识、练习任务和教程主线清楚分开。

## Mermaid 图表

`src/plugins/remark-mermaid.mjs` 会把 MDX 中的 ` ```mermaid ` 代码块转为 `<pre class="mermaid">`，跳过 Shiki 代码高亮。`src/layouts/BookLayout.astro` 仅在当前页面存在 `.mermaid` 元素时动态 `import("mermaid")` 并渲染成 SVG，依赖由 Vite 打包为本地静态资源，完全离线可用，无图页面不会加载额外脚本。
