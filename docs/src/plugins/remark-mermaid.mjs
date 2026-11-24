/**
 * 深度遍历 mdast 语法树，把 ```mermaid 代码块转为保留换行文本的 <pre class="mermaid">。
 *
 * @param {any} node 当前遍历到的 mdast 节点。
 */
function walk(node) {
  if (!node || typeof node !== "object" || !Array.isArray(node.children)) {
    return;
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    if (child && child.type === "code" && child.lang === "mermaid") {
      // 改为非 code 节点跳过 Shiki 语法高亮，把原始图定义直接交给客户端 mermaid 渲染。
      node.children[i] = {
        type: "mermaid",
        data: {
          hName: "pre",
          hProperties: {
            className: ["mermaid"],
          },
          hChildren: [{ type: "text", value: child.value }],
        },
      };
      continue;
    }

    walk(child);
  }
}

/**
 * Remark 插件：将 ```mermaid 围栏代码块转为客户端按需渲染的 Mermaid 容器。
 *
 * @returns {(tree: any) => void} mdast 转换函数。
 */
export default function remarkMermaid() {
  return (tree) => {
    walk(tree);
  };
}
