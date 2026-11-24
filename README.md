# 从零实现 nano-solid [WIP]

> [!NOTE]
> 本项目的目标是我个人用于学习 TS 和前端框架原理，如有错误还望包涵。

课程目录和逐课讲解见 [nano-solid 课程站](https://nano-solid.hanzheng.work/)，本项目下的提交可用于学习和自检。

这门课程用 TypeScript 实现一个受 SolidJS 启发的小型响应式框架。我们先做出能保存状态的 `createSignal`，再让 `createEffect` 记下它实际读取的状态。课程开头的目标是让下面这段代码依次打印 `0`、`1`、`2`。

```ts
// 创建一份响应式状态：count 用来读取，setCount 用来更新。
const [count, setCount] = createSignal(0);

// effect 首次运行会读取 count，之后每当 count 变化就会自动重新执行。
createEffect(() => console.log(count()));

setCount(1);
setCount(2);
```

接下来会用这套模型更新 DOM、管理视图的生命周期、实现 JSX 和列表重排。最后把框架交给 Todo 应用使用，处理持久化、异步请求和任务调度，并验证独立项目可以安装这个包。

学完以后，你可以沿着一次写入解释谁需要重跑、哪个 DOM 节点会变化、视图关闭时由谁释放资源。我们会用能运行的例子和测试验证这些判断。

## 配置环境

请准备好 Git 和 Node.js 24。本课程用 Node.js 24.18.0 和 pnpm 12.21.0 验证。如果系统还没有 pnpm，可以运行 `npm install --global pnpm@12.21.0`。

```sh
# 确认实际运行的工具版本。
node --version
pnpm --version

# 下载课程仓库，进入项目目录并安装依赖。
git clone https://github.com/AlexZHENGH/nano-solid.git
cd nano-solid
pnpm install --frozen-lockfile
```

## 打开课程文档

要在本地预览讲解，先按上面的步骤安装依赖，再启动文档站。

```sh
# 启动 Astro，打开终端给出的本地地址。
pnpm docs:dev
```

让 `pnpm docs:dev` 一直跑着，另开一个终端进入同一个仓库跟着章节做练习。要生成静态站点时，运行 `pnpm docs:build`，HTML 文件会放在 `docs/dist/`。

## 更新课程内容

本节仅供维护者参考。

为了保证项目中每笔 commit 有课程修改语义，且不引入额外无关修改，main 分支会频繁 rebase 强制推送。

要让改动从某一课起就生效，把它补进那一课原来的提交，再重放后面的课程。先切到 `main`，确认工作区干净，再建一个备份分支。这里以修改 `1-learn` 的课文为例。

```sh
git switch main
git status --short
git branch backup/before-lesson-edit
git rebase -i --no-update-refs '1-learn^'

# 修改 init 时，用下一行替换上面的 rebase 命令。
# git rebase -i --root --no-update-refs
```

`1-learn^` 是题目提交的父提交，所以列表从题目开始。在编辑器里把要改的那一行从 `pick` 改成 `edit`。

Git 停下后，修改文件并在当前快照验证，再把改动补进这笔提交。

```sh
git add -- docs/src/pages/lessons/1-setup.mdx
git commit --amend --no-edit
git rebase --continue
```

遇到冲突时，解决后用 `git add` 标记相关文件，再运行 `git rebase --continue`。重放完成后，如果锁文件有变化，先运行 `pnpm install --frozen-lockfile`。然后在 `main` 上刷新并检查本地标签。

```sh
pnpm tags:refresh && pnpm tags:check
```

刷新会根据课文和提交标题补建或迁移标签，并列出仍指向旧历史的分支。核对新历史和标签后，再决定是否清理备份。如果改写了已发布的历史，用 `--atomic` 一起推送 `main` 和迁移后的标签，并用 `--force-with-lease` 为每个引用指定旧哈希。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
