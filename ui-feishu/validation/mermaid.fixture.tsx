import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MarkdownContent } from "../shared/features/conversations/rendering/ContentRenderer";
function Fixture() {
  const [text, setText] = useState("flowchart LR\n A[输入代码] --> B[显示流程图]");
  return <><textarea aria-label="图表代码" value={text} onChange={e => setText(e.target.value)} /><MarkdownContent text={'```mermaid\n' + text + '\n```'} codeBlocks /><MarkdownContent text={'```js\nconst answer = 42;\n```'} codeBlocks /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
