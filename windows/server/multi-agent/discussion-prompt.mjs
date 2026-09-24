const visibleMessageText = (message, agentId) => {
  const text = String(message?.text || "").trim();
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments.map((file) => String(file?.name || "").trim()).filter(Boolean)
    : [];
  if (!text && !attachments.length && !message?.replyTo) return "";
  const kind = message?.type === "system"
    ? "系统"
    : message?.type === "agent" && message?.agentId && message.agentId === agentId
      ? "我"
      : message?.type === "agent"
        ? "员工"
        : "成员";
  const reply = message?.replyTo?.authorName
    ? "（回复" + message.replyTo.authorName + (message.replyTo.text ? "：" + message.replyTo.text : "") + "）"
    : "";
  const attachmentText = attachments.length ? " [Attachments: " + attachments.join(", ") + "]" : "";
  return "[" + kind + " " + String(message?.authorName || "Unknown").trim() + "] " + text + reply + attachmentText;
};

const clipText = (value, maxLength) => {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) + "…（后文省略，公共记录里有全文）" : text;
};

export const buildDiscussionPrompt = ({
  agent,
  agents = [],
  messages = [],
  omittedMessageCount = 0,
  omittedBeforeCount,
  heldBackCount = 0,
  firstParticipation = false,
  outputInstructions = "",
  targetProjectRoot = "",
  assignment = null,
  quotedMessage = null,
}) => {
  const agentName = String(agent?.name || "当前员工").trim();
  const otherAgents = agents.filter((item) => item.id !== agent?.id);
  const handoffAgentNames = otherAgents.map((item) => "@" + item.name).join(", ");
  const assignmentId = String(assignment?.id || "");
  const quotedId = String(quotedMessage?.id || "");
  const transcriptMessages = messages.filter((message) => message?.id !== quotedId);
  const assignmentIndex = assignmentId ? transcriptMessages.findIndex((message) => message?.id === assignmentId) : -1;
  const hasFollowing = assignmentIndex >= 0 && transcriptMessages.slice(assignmentIndex + 1).some((message) => visibleMessageText(message, agent?.id));
  const transcriptParts = [];
  let previousKeptSequence = null;
  for (const message of transcriptMessages) {
    if (hasFollowing && message?.id === assignmentId) {
      transcriptParts.push("（这次要完成的是下面这条，后面的消息只作补充）");
    }
    const text = visibleMessageText({ ...message, text: clipText(message.text, 6000) }, agent?.id);
    if (!text) continue;
    const sequence = Number(message?.sequence);
    if (Number.isSafeInteger(previousKeptSequence) && Number.isSafeInteger(sequence) && sequence > previousKeptSequence + 1) {
      transcriptParts.push("（中间省略了 " + (sequence - previousKeptSequence - 1) + " 条，公共记录里仍然保留，不要把上下两条当成紧挨着发生）");
    }
    transcriptParts.push(text);
    if (Number.isSafeInteger(sequence) && sequence > 0) previousKeptSequence = sequence;
  }
  const transcript = transcriptParts.join("\n\n");
  const assignmentInTranscript = Boolean(assignmentId) && transcriptMessages.some((message) => message?.id === assignmentId);
  const previous = assignmentIndex > 0 ? transcriptMessages[assignmentIndex - 1] : null;
  const assignmentMessage = assignmentIndex >= 0 ? transcriptMessages[assignmentIndex] : null;
  const assignmentSequence = Number(assignmentMessage?.sequence ?? assignment?.sequence);
  const earlierSequence = Number(previous?.sequence);
  const previousIsAdjacent = Number.isSafeInteger(assignmentSequence)
    && Number.isSafeInteger(earlierSequence)
    && assignmentSequence === earlierSequence + 1;
  const assignmentText = assignment
    ? visibleMessageText({ ...assignment, text: clipText(assignment.text, 4000) }, agent?.id)
    : "";
  const previousText = previous
    ? visibleMessageText({ ...previous, text: clipText(previous.text, 500) }, agent?.id)
    : "";
  const alreadyNamed = otherAgents
    .filter((item) => Array.isArray(assignment?.targetAgentIds) && assignment.targetAgentIds.includes(item.id))
    .map((item) => "@" + item.name);
  const quotedText = quotedMessage
    ? visibleMessageText({ ...quotedMessage, text: clipText(quotedMessage.text, 6000) }, agent?.id)
    : "";
  const earlierOmitted = Number.isInteger(omittedBeforeCount) ? omittedBeforeCount : omittedMessageCount;
  const contextIntro = firstParticipation
    ? "这是你第一次参与这个群。更早的公共记录没有放进你的会话；下面只有最近少数消息，用来理解这次点名。"
    : "下面只包含还没有交给你的新消息，按原来的顺序排列。你自己的会话里已经有更早的工作记录，不要把它们当成新的用户要求。";
  const lines = [
    targetProjectRoot ? "目标项目：" + targetProjectRoot : "",
    "你是" + agentName + "，只能以自己的身份回复。不得代替其他员工发言，也不得用“[员工名]”等格式模拟他们的回复。",
    "消息标记：成员是真人，员工是其他同事，我是你已经发到群里的话，系统是状态说明。",
    handoffAgentNames ? "只有你做不到、必须请其他员工接着做时，才在最终回复里准确写：" + handoffAgentNames + "。系统会在你回复后调用被提及的员工。不要声称未被调用的员工已经回复或完成工作。" : "",
    alreadyNamed.length ? "这条消息已经点了" + alreadyNamed.join("、") + "，他们会按原来的顺序回复。不要为了交接再点一次。" : "",
    contextIntro,
    earlierOmitted > 0
      ? "下面是这次交给你的群聊，按发生顺序排列。较早的 " + earlierOmitted + " 条没有放进来，公共记录里仍然保留。"
      : "下面是这次交给你的群聊，按发生顺序排列。",
    transcript || (assignmentText ? "" : "（没有新增群聊消息）"),
    quotedText ? "这条点名引用的原话不在上面的记录里，回答时以原话为准：" : "",
    quotedText,
    assignmentInTranscript && !hasFollowing ? "你要回复的是上面最后一次点到你的那条消息。更早的内容用来理解它，不是另一项任务。" : "",
    !assignmentInTranscript && assignmentText ? "你要回复的是下面这一条。更早的内容用来理解它，不是另一项任务。" : "",
    !assignmentInTranscript && assignmentText ? assignmentText : "",
    previousText && previousIsAdjacent && !assignment?.replyTo ? "这条点名没有单独引用。紧挨着的上一条是：" + previousText + "。这次如果没有换主题，就接着它说，不要自己换一个对象。" : "",
    assignment?.replyTo ? "用户明确在回复标出的那一条，就以那一条为对象。" : "",
    heldBackCount > 0 ? "还有 " + heldBackCount + " 条点到你的新消息这次没有放进来。不要猜测内容，下一轮会单独交给你。" : "",
  ];
  if (outputInstructions) lines.push("", outputInstructions);
  return lines.filter((line, index) => line || index === lines.length - 1).join("\n");
};
