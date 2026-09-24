import { readFileSync, writeFileSync } from "node:fs";
const replace = (file, pairs) => {
  let text = readFileSync(file, "utf8");
  for (const [from, to] of pairs) {
    const forms = [from, from.replace(/\n/g, "\r\n")];
    let matched = null;
    for (const form of forms) {
      if (text.split(form).length - 1 === 1) { matched = form; break; }
    }
    if (!matched) throw new Error(file + " missing: " + JSON.stringify(from.slice(0, 160)));
    const toText = matched.includes("\r") ? to.replace(/\n/g, "\r\n") : to;
    text = text.replace(matched, toText);
  }
  writeFileSync(file, text);
  console.log("updated " + file);
};

replace("windows/server/multi-agent-service.mjs", [[
"    discussions.set(jobId, discussion);\n    void setStatus(targets[0], { phase: \"queued\", label: \"已加入讨论队列\", detail: \"\", active: true });\n    workQueue = workQueue",
"    discussions.set(jobId, discussion);\n    const queuedBehind = [...discussions.values()].filter((item) => item.jobId !== jobId && !item.cancelled).length;\n    const lead = room.getAgent(targets[0]);\n    if (!lead?.active) {\n      void setStatus(targets[0], { phase: \"queued\", label: \"已加入讨论队列\", detail: \"\", active: true });\n    }\n    workQueue = workQueue",
], [
"    return { jobId, agentIds: targets, status: \"queued\" };",
"    const queuedBehind = [...discussions.values()].filter((item) => item.jobId !== jobId && !item.cancelled).length;\n    return {\n      jobId,\n      agentIds: targets,\n      agentNames: targets.map((agentId) => room.getAgent(agentId)?.name).filter(Boolean),\n      status: \"queued\",\n      queuedBehind,\n    };",
]]);
