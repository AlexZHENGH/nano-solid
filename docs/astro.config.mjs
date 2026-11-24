import mdx from "@astrojs/mdx";
import solid from "@astrojs/solid-js";
import { defineConfig } from "astro/config";
import remarkCallouts from "./src/plugins/remark-callouts.mjs";
import remarkMermaid from "./src/plugins/remark-mermaid.mjs";

/** 预先生成课程页面，MDX 可以嵌入由 SolidJS 实现的交互演示与 Mermaid 图表。 */
export default defineConfig({
  output: "static",
  integrations: [
    // 启用 GFM 表格、侧注/练习提示框（> [!NOTE] / [!PRACTICE]）以及 Mermaid 图表块。
    mdx({ gfm: true, remarkPlugins: [remarkCallouts, remarkMermaid] }),
    solid(),
  ],
});
