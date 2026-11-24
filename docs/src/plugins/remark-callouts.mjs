/** 支持的提示框类型与对应的中文标题，包含课程专用的 PRACTICE 练习框。 */
const ALERT_TITLES = {
  NOTE: "说明",
  TIP: "提示",
  IMPORTANT: "重要",
  WARNING: "注意",
  CAUTION: "警示",
  PRACTICE: "练习",
};

/** 匹配引用块首行单独出现的 [!NOTE] / [!PRACTICE] 等标记，允许紧跟换行或行尾。 */
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|PRACTICE)\](?:\r?\n|$)/i;

/**
 * 尝试把单个引用块节点转换为语义化的提示框 <aside>。
 *
 * @param {any} node mdast 节点。
 */
function transformBlockquote(node) {
  if (node.type !== "blockquote" || !Array.isArray(node.children) || node.children.length === 0) {
    return;
  }

  const firstParagraph = node.children[0];
  if (
    firstParagraph.type !== "paragraph" ||
    !Array.isArray(firstParagraph.children) ||
    firstParagraph.children.length === 0
  ) {
    return;
  }

  const firstChild = firstParagraph.children[0];
  if (firstChild.type !== "text" || typeof firstChild.value !== "string") {
    return;
  }

  const match = ALERT_MARKER.exec(firstChild.value);
  if (!match) {
    return;
  }

  const matchedText = match[0];
  const alertType = match[1].toUpperCase();
  const hasLineBreakInText = matchedText.endsWith("\n");

  if (hasLineBreakInText) {
    // 紧跟换行的写法（> [!NOTE]\n> 正文）：裁掉标记和换行，保留同行剩余正文。
    const rest = firstChild.value.slice(matchedText.length);
    if (rest.length > 0) {
      firstChild.value = rest;
    } else {
      firstParagraph.children.shift();
    }
  } else if (firstParagraph.children.length === 1) {
    // 空行分隔的写法（> [!NOTE]\n>\n> 正文）：整段只有标记，直接移除首段。
    firstParagraph.children.shift();
  } else if (firstParagraph.children[1].type === "break") {
    // 硬换行写法（末尾两空格或反斜杠）：同时移除标记与换行节点。
    firstParagraph.children.splice(0, 2);
  } else {
    // 同行紧跟其他行内节点时不视为独立提示框标记，保持普通引用块。
    return;
  }

  if (firstParagraph.children.length === 0) {
    node.children.shift();
  }

  const kind = alertType.toLowerCase();
  const title = ALERT_TITLES[alertType];

  // 通过 mdast 的 hName / hProperties 让 remark-rehype 直接输出 <aside>。
  node.data = {
    ...node.data,
    hName: "aside",
    hProperties: {
      className: ["callout", `callout-${kind}`],
    },
  };

  // 在提示框顶部插入统一的中文标题段落。
  node.children.unshift({
    type: "paragraph",
    data: {
      hName: "p",
      hProperties: {
        className: ["callout-title"],
      },
    },
    children: [{ type: "text", value: title }],
  });
}

/**
 * 深度遍历 mdast 语法树，转换所有符合 GitHub Alert 语法的引用块。
 *
 * @param {any} node 当前遍历到的 mdast 节点。
 */
function walk(node) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node.type === "blockquote") {
    transformBlockquote(node);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child);
    }
  }
}

/**
 * Remark 插件：将 > [!NOTE] 等 GitHub 风格引用块转为侧注提示框。
 *
 * @returns {(tree: any) => void} mdast 转换函数。
 */
export default function remarkCallouts() {
  return (tree) => {
    walk(tree);
  };
}
