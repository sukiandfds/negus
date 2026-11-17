import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const unavailable = () => Object.assign(new Error("文件不存在或不在当前项目可访问范围内"), { statusCode: 404 });
const decode = (value) => { try { return decodeURI(value); } catch { return value; } };

// Only a destination actually referenced by this message may be opened.
export async function resolveConversationFile(session, messageId, href) {
  const message = session?.messages?.find((entry) => entry.id === messageId);
  if (!message || !session.cwd || !href || href.length > 8192) throw unavailable();
  const text = [message.text, ...(message.blocks || []).filter((b) => b.type === "markdown").map((b) => b.text)].join("\n");
  const destinations = [...text.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:[^\s()]|\([^()]*\))+))(?:\s+["'][^\n]*?["'])?\s*\)|^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)]
    .map((match) => decode(match[1] || match[2] || match[3] || match[4]));
  if (!destinations.includes(decode(href))) throw unavailable();
  let target = href.replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+)?)$/, "");
  try {
    if (/^file:/i.test(target)) target = fileURLToPath(target);
    else {
      if (/^(?![a-z]:[\\/])[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(target)) throw unavailable();
      target = decodeURIComponent(target);
    }
    const root = await fs.realpath(session.cwd);
    const file = await fs.realpath(path.resolve(root, target));
    const relative = path.relative(root, file);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw unavailable();
    if (!(await fs.stat(file)).isFile()) throw unavailable();
    return file;
  } catch { throw unavailable(); }
}
