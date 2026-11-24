import { spawnSync } from "node:child_process";

/** 记录标签对象本身，提交哈希相同也可能带有单独的标签注释。 */
type Tag = { oid: string; kind: string };

/** 已找到唯一目标的标签变更，旧提交存在时还要列出包含它的分支。 */
type TagChange = { name: string; target: string; previous?: Tag; branches?: string[] };

const directories = {
  learn: "docs/src/pages/lessons/",
  solution: "docs/src/solutions/",
};
const mainRef = "refs/heads/main";
const publishedRef = "refs/remotes/origin/main";

// 整数章节和小节可以有练习；以 .0 结尾的总览只有页面。
const lessonNumber = "[1-9][0-9]*(?:\\.[1-9][0-9]*)?";
const lessonFile = new RegExp(`^(${lessonNumber})-[^/]+\\.mdx$`);
const courseSubject = new RegExp(`^(learn|solution)\\((${lessonNumber})\\):`);
const courseTag = new RegExp(`^${lessonNumber}-(learn|solution)$`);

/**
 * 运行 Git 并读取输出。只有明确允许时才把状态码 1 视为查不到。
 * @param args 传给 Git 的参数。
 * @param options 是否允许查不到，以及要写入标准输入的内容。
 * @returns Git 的输出，查不到时为空字符串。
 */
function git(args: string[], options: { allowMissing?: boolean; input?: string } = {}): string {
  const result = spawnSync("git", args, { encoding: "utf8", input: options.input });
  if (result.error) throw result.error;
  if (result.status === 0) return result.stdout.trimEnd();
  if (options.allowMissing && result.status === 1) return "";
  throw new Error(result.stderr.trim() || `git ${args.join(" ")} 执行失败`);
}

/**
 * 从提交树里找课文和对应的解答，按标签名索引文件。
 * @param commit 要查看的提交哈希。
 * @returns 应当存在的标签及其对应文档路径。
 */
function readCourseFiles(commit: string): Map<string, string> {
  const files = new Set(
    git([
      "ls-tree",
      "--full-tree",
      "-r",
      "--name-only",
      "-z",
      commit,
      "--",
      ...Object.values(directories),
    ]).split("\0"),
  );
  const expected = new Map<string, string>();

  // 只看已提交的文件；解答通过文件名与它所在的练习页配对。
  for (const stage of ["learn", "solution"] as const) {
    const directory = directories[stage];
    for (const path of files) {
      if (!path.startsWith(directory)) continue;
      const file = path.slice(directory.length);
      const number = lessonFile.exec(file)?.[1];
      if (!number) continue;
      if (stage === "solution" && !files.has(directories.learn + file)) {
        throw new Error(`解答 ${path} 缺少对应的练习页`);
      }
      const name = `${number}-${stage}`;
      const previous = expected.get(name);
      if (previous) throw new Error(`${name} 对应多份文档（${previous}、${path}）`);
      expected.set(name, path);
    }
  }
  return expected;
}

/**
 * 按提交标题收集当前课程的候选目标。同名提交全保留，供调用者检查歧义。
 * @param head 当前分支的提交哈希。
 * @returns 每个课程标签可能对应的提交。
 */
function readCourseHistory(head: string): Map<string, string[]> {
  const history = new Map<string, string[]>();
  const entries = git(["log", "--first-parent", "--format=%H%x09%s", head]).split("\n");
  for (const entry of entries) {
    const [oid = "", subject = ""] = entry.split("\t");
    const match = courseSubject.exec(subject);
    if (!match) continue;
    const name = `${match[2]}-${match[1]}`;
    const commits = history.get(name);
    if (commits) commits.push(oid);
    else history.set(name, [oid]);
  }
  return history;
}

/** 只读取符合课程命名约定的标签，保留它们原有的 Git 对象。 */
function readTags(): Map<string, Tag> {
  const tags = new Map<string, Tag>();
  const entries = git([
    "for-each-ref",
    "--format=%(refname:strip=2)%09%(objectname)%09%(objecttype)",
    "refs/tags/",
  ]);
  for (const entry of entries.split("\n")) {
    const [name = "", oid = "", kind = ""] = entry.split("\t");
    if (courseTag.test(name)) tags.set(name, { oid, kind });
  }
  return tags;
}

/** 保留包含旧提交的完整引用名，方便区分本地备份和远端跟踪分支。 */
function branchesContaining(commit: string): string[] {
  const output = git([
    "for-each-ref",
    "--format=%(refname)",
    "--contains",
    commit,
    "refs/heads/",
    "refs/remotes/",
  ]);
  return output ? output.split("\n") : [];
}

/** 显示分支名时省掉 Git 引用路径。 */
function branchNames(refs: string[]): string {
  return refs.map((ref) => ref.replace(/^refs\/(heads|remotes)\//, "")).join("、");
}

/**
 * 一次应用全部标签变更。Git 在写入前验证分支和原标签的值，避免覆盖同时发生的修改。
 * @param head 计算标签目标时的 main。
 * @param published 核对过的 origin/main，尚未发布时为空。
 * @param expected 本次检查覆盖的标签名。
 * @param tags 写入前读取的现有标签。
 * @param changes 需要创建或移动的标签。
 */
function applyTags(
  head: string,
  published: string,
  expected: Map<string, string>,
  tags: Map<string, Tag>,
  changes: TagChange[],
): void {
  if (changes.length === 0) return;
  const operations = ["start", `verify ${mainRef} ${head}`];
  if (published) operations.push(`verify ${publishedRef} ${published}`);

  // 正确标签也一起核对，保证写完后整个检查范围仍然成立。
  const updates = new Map(changes.map((change) => [change.name, change]));
  for (const name of expected.keys()) {
    const ref = `refs/tags/${name}`;
    const change = updates.get(name);
    const previous = tags.get(name);
    if (!change) operations.push(`verify ${ref} ${previous!.oid}`);
    else if (previous) operations.push(`update ${ref} ${change.target} ${previous.oid}`);
    else operations.push(`create ${ref} ${change.target}`);
  }
  operations.push("prepare", "commit", "");
  git(["update-ref", "-m", "刷新课程标签", "--stdin"], { input: operations.join("\n") });
}

/** 先核对文档、提交和发布记录，确认整批目标后才写入标签。 */
function main(): void {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || (mode !== "--check" && mode !== "--refresh")) {
    throw new Error("请用 pnpm tags:check 检查，或用 pnpm tags:refresh 刷新");
  }
  const refresh = mode === "--refresh";
  const branch = git(["symbolic-ref", "--quiet", "HEAD"], { allowMissing: true });
  if (refresh && branch !== mainRef) {
    throw new Error("请在 main 上完成合并或重放后刷新标签");
  }

  const head = git(["rev-parse", "--verify", "--quiet", "HEAD"], { allowMissing: true });
  const expected = head ? readCourseFiles(head) : new Map<string, string>();
  const history = head && expected.size ? readCourseHistory(head) : new Map<string, string[]>();
  const tags = readTags();
  const failures: string[] = [];
  const changes: TagChange[] = [];

  // 历史快照只检查自己的课程。main 还要避免重放时误丢已发布的课文或解答。
  const published =
    branch === mainRef
      ? git(["rev-parse", "--verify", "--quiet", publishedRef], { allowMissing: true })
      : "";
  const publishedFiles = published && published !== head ? readCourseFiles(published) : expected;
  for (const [name, path] of publishedFiles) {
    if (!expected.has(name)) failures.push(`main 缺少 origin/main 已发布的 ${name}（${path}）`);
  }

  // 其他分支上的课可以先有标签，当前 main 缺文档时只提示它的位置。
  if (branch === mainRef) {
    for (const name of tags.keys()) {
      if (expected.has(name) || publishedFiles.has(name)) continue;
      const commit = git(["rev-parse", "--verify", "--quiet", `refs/tags/${name}^{commit}`], {
        allowMissing: true,
      });
      const branches = commit ? branchesContaining(commit) : [];
      const location = branches.length ? `（所在分支 ${branchNames(branches)}）` : "";
      console.log(`${name} 对应文档不在当前 main${location}`);
    }
  }

  // 目标须来自当前历史，并且对应文档在目标快照中已经存在。
  for (const [name, path] of expected) {
    const candidates = history.get(name) ?? [];
    const target = candidates[0];
    if (!target) {
      failures.push(`缺少 ${name} 对应的课程提交（${path}）`);
      continue;
    }
    if (candidates.length > 1) {
      failures.push(`${name} 有多个候选提交（${candidates.join("、")}）`);
      continue;
    }
    if (!readCourseFiles(target).has(name)) {
      failures.push(`${name} 的目标提交 ${target} 缺少对应文档（${path}）`);
      continue;
    }

    const previous = tags.get(name);
    if (!previous) {
      changes.push({ name, target });
      continue;
    }
    const oldCommit =
      previous.kind === "commit"
        ? previous.oid
        : git(["rev-parse", "--verify", "--quiet", `refs/tags/${name}^{commit}`], {
            allowMissing: true,
          });
    if (!oldCommit) {
      failures.push(`${name} 没有指向提交`);
    } else if (oldCommit !== target) {
      if (refresh && previous.kind === "tag") {
        failures.push(`${name} 带有标签注释，请手动迁移到 ${target} 以保留注释`);
      } else {
        changes.push({ name, target, previous, branches: branchesContaining(oldCommit) });
      }
    }
  }

  // 检查模式报告差异；刷新模式有任何错误就不提交引用事务。
  if (!refresh) {
    for (const { name, target, previous, branches = [] } of changes) {
      const location = branches.length ? `（旧提交所在分支 ${branchNames(branches)}）` : "";
      failures.push(
        previous ? `${name} 指向 ${previous.oid}${location}，应为 ${target}` : `缺失 ${name}`,
      );
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }

  if (refresh) applyTags(head, published, expected, tags, changes);
  const backupBranches = new Set<string>();
  for (const { name, target, previous, branches = [] } of changes) {
    const location = branches.length ? `（旧提交所在分支 ${branchNames(branches)}）` : "";
    console.log(
      previous ? `迁移 ${name} ${previous.oid} → ${target}${location}` : `新增 ${name} → ${target}`,
    );
    for (const ref of branches) {
      if (ref.startsWith("refs/heads/") && ref !== mainRef) backupBranches.add(ref);
    }
  }
  if (backupBranches.size) {
    console.log(
      `确认新历史和标签后，可检查这些分支是否还需保留：${branchNames([...backupBranches])}`,
    );
  }
  console.log(expected.size ? `已检查 ${expected.size} 个课程标签` : "当前快照没有课程");
}

try {
  main();
} catch (error) {
  console.error(`无法处理课程标签：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
