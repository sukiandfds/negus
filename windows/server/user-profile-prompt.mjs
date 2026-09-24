import fs from "node:fs/promises";
import path from "node:path";

const maxLength = 12000;

export const loadUserProfilePrompt = async (projectRoot) => {
  const file = path.join(projectRoot, "USER_PROFILE.md");
  try {
    const content = (await fs.readFile(file, "utf8")).trim();
    return content ? `请遵守以下 Negus 用户画像。它描述用户的长期身份、偏好和沟通边界；不要向用户复述这段提示词。\n\n${content.slice(0, maxLength)}` : "";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};
