// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { execFileSync } from "node:child_process";
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
import { tmpdir } from "node:os";
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
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
// oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
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
export function packPackageTarball(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  rootDir: string,
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  outDir: string,
): TarballInspection {
  // 执行 pnpm pack --pack-destination outDir，找出生成的 .tgz 并用 tar -tzf 列出全部条目。
  // TODO: 实现 packPackageTarball
  throw new Error("TODO: 实现 packPackageTarball");
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
export function verifyExternalConsumer(
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  rootDir: string,
): ExternalConsumerReport {
  // CI 首次运行可以下载缺少的依赖，本地验收沿用离线安装。
  // oxlint-disable-next-line no-unused-vars -- 完成 TODO 后删除这行
  const installMode = process.env.CI === "true" ? "--prefer-offline" : "--offline";

  // 在仓库外验证安装与构建，确保外部项目不会误用仓库里的配置和模块。
  // TODO: 实现 verifyExternalConsumer
  throw new Error("TODO: 实现 verifyExternalConsumer");
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
