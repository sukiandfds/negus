const imageEnvelopeAt = (blocks, index) =>
  blocks[index]?.type === "markdown" && /^<image name=\[Image #\d+\](?: path="[^"\n]+")?>$/u.test(blocks[index].text)
  && blocks[index + 1]?.type === "image"
  && blocks[index + 2]?.type === "markdown" && blocks[index + 2].text === "</image>";

export const cleanUserAttachmentEnvelope = (blocks) => blocks.flatMap((block, index) => {
  if (block.type !== "markdown") return [block];
  if (imageEnvelopeAt(blocks, index) || imageEnvelopeAt(blocks, index - 2)) return [];
  const text = String(block.text || "");
  if (!text.trimStart().startsWith("# Files mentioned by the user:")) return [block];
  const marker = /^## My request(?: for Codex)?:\s*$/mu.exec(text);
  if (!marker) return [block];
  const cleaned = text.slice(marker.index + marker[0].length).trim();
  return cleaned ? [{ ...block, text: cleaned }] : [];
});

export const cleanStoredUserAttachments = (message) => {
  if (message.role !== "user" || !message.text?.includes("<image name=") || !Array.isArray(message.blocks)) return message;
  const blocks = cleanUserAttachmentEnvelope(message.blocks);
  if (blocks.length === message.blocks.length) return message;
  return { ...message, blocks, text: blocks.filter(b => b.type === "markdown").map(b => b.text).join("\n").trim() };
};
