import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** pnpm pack 产出的压缩包路径与包内文件清单。 */
export type TarballInspection = {
  tarballPath: string;
  entries: string[];
};

/** 独立外部项目全链路验收报告。 */
export type ExternalConsumerReport = {
  tarballEntries: string[];
  resolvedRoot: string;
  resolvedVite: string;
  blockedDeepImportCode: string;
  reactiveSum: number;
  bundledJs: string;
};

/** 从当前仓库已安装的 node_modules 读取精确版本号，供临时外部项目复用同一份 pnpm 缓存。 */
function readInstalledVersion(rootDir: string, pkgName: string): string {
  const pkgJsonPath = resolve(rootDir, "node_modules", pkgName, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version: string };
  return pkg.version;
}

/**
 * 调用 pnpm pack 在指定目录生成真实发布 tarball，并通过 tar -tzf 提取压缩包内的完整文件清单。
 *
 * @param rootDir nano-solid 仓库根目录。
 * @param outDir 存放 .tgz 的目标目录。
 * @returns 生成的 tarball 路径与按字典序排列的内部文件列表。
 */
export function packPackageTarball(rootDir: string, outDir: string): TarballInspection {
  // 执行 pnpm pack --pack-destination outDir，找出生成的 .tgz 并用 tar -tzf 列出全部条目。
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(pnpmBin, ["pack", "--pack-destination", outDir], {
    cwd: rootDir,
    stdio: "pipe",
  });

  const tarballName = readdirSync(outDir).find((name) => name.endsWith(".tgz"));
  if (!tarballName) {
    throw new Error(`No .tgz tarball produced in ${outDir}`);
  }
  const tarballPath = join(outDir, tarballName);
  const rawEntries = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
  const entries = rawEntries
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((a, b) => a.localeCompare(b));

  return { tarballPath, entries };
}

/**
 * 在系统临时目录中搭建完全独立于本仓库的外部消费项目：
 * 1. 通过 pnpm pack 打包并在外部项目安装 nano-solid-*.tgz；
 * 2. 在无 customConditions 的标准 tsconfig.json 下执行 tsc --noEmit；
 * 3. 在无 resolve.conditions 的标准 vite.config.ts 下引入 nano-solid/vite 执行 vite build；
 * 4. 在原生 Node 24 中运行冒烟脚本验证 dist/ 解析、响应式计算与 ERR_PACKAGE_PATH_NOT_EXPORTED 拦截。
 *
 * @param rootDir nano-solid 仓库根目录。
 * @returns 汇总打包清单、解析路径、运行时结果与打包产物片段的验收报告。
 */
export function verifyExternalConsumer(rootDir: string): ExternalConsumerReport {
  // CI 首次运行可以下载缺少的依赖，本地验收沿用离线安装。
  const installMode = process.env.CI === "true" ? "--prefer-offline" : "--offline";

  // 在仓库外验证安装与构建，确保外部项目不会误用仓库里的配置和模块。
  const workspaceDir = mkdtempSync(join(tmpdir(), "nano-solid-consumer-"));
  const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  try {
    const packDir = join(workspaceDir, "pack");
    const consumerDir = join(workspaceDir, "app");
    mkdirSync(packDir, { recursive: true });
    mkdirSync(join(consumerDir, "src"), { recursive: true });

    // 1. 打包真实 .tgz（会自动触发 prepack -> pnpm run build:lib）。
    const { tarballPath, entries: tarballEntries } = packPackageTarball(rootDir, packDir);

    // 2. 写入标准外部消费者的项目文件（不带任何 customConditions 或 resolve.conditions，仅对齐 packageManager 以复用本机 pnpm 缓存）。
    const rootPkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")) as {
      packageManager?: string;
    };
    const tsVersion = readInstalledVersion(rootDir, "typescript");
    const viteVersion = readInstalledVersion(rootDir, "vite");

    writeFileSync(
      join(consumerDir, "pnpm-workspace.yaml"),
      "allowBuilds:\n  esbuild: true\n",
      "utf8",
    );
    writeFileSync(
      join(consumerDir, "package.json"),
      JSON.stringify(
        {
          name: "nano-solid-external-consumer",
          private: true,
          type: "module",
          ...(rootPkg.packageManager ? { packageManager: rootPkg.packageManager } : {}),
          dependencies: {
            "nano-solid": `file:${tarballPath}`,
          },
          devDependencies: {
            typescript: tsVersion,
            vite: viteVersion,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(consumerDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "nodenext",
            moduleResolution: "nodenext",
            jsx: "react-jsx",
            jsxImportSource: "nano-solid",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["src/**/*.tsx", "vite.config.ts"],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(consumerDir, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { nanoSolid } from "nano-solid/vite";

export default defineConfig({
  plugins: [nanoSolid()],
  build: {
    minify: false,
  },
});
`,
      "utf8",
    );
    writeFileSync(
      join(consumerDir, "index.html"),
      `<!doctype html>
<html lang="zh-CN">
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      "utf8",
    );
    writeFileSync(
      join(consumerDir, "src", "main.tsx"),
      `import { For, Show, batch, createMemo, createSignal, render } from "nano-solid";

function ExternalApp(): Node {
  const [items, setItems] = createSignal<string[]>(["A", "B"]);
  const [draft, setDraft] = createSignal("");
  const count = createMemo(() => items().length);
  let inputRef: HTMLInputElement | undefined;

  const add = () => {
    const next = draft().trim();
    if (!next) return;
    batch(() => {
      setItems([...items(), next]);
      setDraft("");
    });
    inputRef?.focus();
  };

  return (
    <section class="external-app">
      <input
        type="text"
        ref={(el) => {
          inputRef = el;
        }}
        value={() => draft()}
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
      <button type="button" disabled={() => draft().trim().length === 0} onClick={add}>
        添加（共 {() => count()} 项）
      </button>
      <Show when={() => count() > 0} fallback={() => <p>空</p>}>
        {() => (
          <ul>
            <For each={items}>{(item) => <li>{() => item()}</li>}</For>
          </ul>
        )}
      </Show>
    </section>
  );
}

const root = document.querySelector("#app");
if (root) {
  render(() => <ExternalApp />, root);
}
`,
      "utf8",
    );
    writeFileSync(
      join(consumerDir, "src", "smoke.mjs"),
      `import { batch, createMemo, createRoot, createSignal } from "nano-solid";

const resolvedRoot = import.meta.resolve("nano-solid");
const resolvedVite = import.meta.resolve("nano-solid/vite");

let reactiveSum = 0;
const dispose = createRoot((stop) => {
  const [a, setA] = createSignal(1);
  const [b, setB] = createSignal(2);
  const sum = createMemo(() => a() + b());
  batch(() => {
    setA(10);
    setB(20);
  });
  reactiveSum = sum();
  return stop;
});
dispose();

let blockedDeepImportCode = "";
try {
  await import("nano-solid/dist/reactive.js");
} catch (error) {
  blockedDeepImportCode = error.code ?? String(error);
}

console.log(
  JSON.stringify({
    resolvedRoot,
    resolvedVite,
    blockedDeepImportCode,
    reactiveSum,
  }),
);
`,
      "utf8",
    );

    // 3. 用选定的安装模式装入 tarball 和外部项目的依赖。
    execFileSync(pnpmBin, ["install", installMode], {
      cwd: consumerDir,
      stdio: "pipe",
    });

    // 4. 运行外部 tsc --noEmit 与 vite build，验证 dist/*.d.ts 与 nano-solid/vite 插件。
    const tscBin = join(consumerDir, "node_modules", ".bin", "tsc");
    const viteBin = join(consumerDir, "node_modules", ".bin", "vite");
    execFileSync(tscBin, ["--noEmit"], { cwd: consumerDir, stdio: "pipe" });
    execFileSync(viteBin, ["build"], { cwd: consumerDir, stdio: "pipe" });

    const assetsDir = join(consumerDir, "dist", "assets");
    const jsAsset = readdirSync(assetsDir).find((name) => name.endsWith(".js"));
    if (!jsAsset) {
      throw new Error(`No JS bundle emitted in ${assetsDir}`);
    }
    const bundledJs = readFileSync(join(assetsDir, jsAsset), "utf8");

    // 5. 运行原生 Node 24 冒烟脚本，验证 exports 命中 dist/ 且越界路径被拦截。
    const smokeOut = execFileSync(process.execPath, ["src/smoke.mjs"], {
      cwd: consumerDir,
      encoding: "utf8",
    });
    const smoke = JSON.parse(smokeOut) as {
      resolvedRoot: string;
      resolvedVite: string;
      blockedDeepImportCode: string;
      reactiveSum: number;
    };

    return {
      tarballEntries,
      resolvedRoot: smoke.resolvedRoot,
      resolvedVite: smoke.resolvedVite,
      blockedDeepImportCode: smoke.blockedDeepImportCode,
      reactiveSum: smoke.reactiveSum,
      bundledJs,
    };
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

// 允许通过 `pnpm run verify:pack` 直接在命令行独立执行完整外部项目验收。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const report = verifyExternalConsumer(process.cwd());
  console.log("External consumer verification passed:");
  console.log(`- tarball files: ${report.tarballEntries.length}`);
  console.log(`- resolved root: ${report.resolvedRoot}`);
  console.log(`- resolved vite: ${report.resolvedVite}`);
  console.log(`- blocked deep import: ${report.blockedDeepImportCode}`);
  console.log(`- reactive sum: ${report.reactiveSum}`);
}
