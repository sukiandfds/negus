import fs from "node:fs/promises";
import { imageSize } from "image-size";
import { createHappyEveringImageClient } from "./happyevering-client.mjs";
import { createImageSettingsStore, requireImageConnection } from "./image-settings.mjs";
import { providerImageRequestFromArgs } from "./image-contract.mjs";

// Read at invocation time: saving settings affects the next tool call, not an in-flight image.
export const createConfiguredImageClient = ({ store = createImageSettingsStore(), createClient = createHappyEveringImageClient } = {}) => {
  const invoke = async (operation, args) => {
    const settings = await store.read();
    const entry = settings.configurations.find(item => item.id === settings.defaultId);
    if (settings.revision && !entry) throw new Error("请在设置 → 图片生成中选择默认配置");
    const options = entry ? { ...requireImageConnection(entry), model: entry.model || undefined } : {};
    // Preserve explicit resolution switching for the existing GPT Image family.
    const configuredModel = entry ? entry.model : process.env.NEGUS_IMAGE_MODEL || process.env.LYNN_IMAGE_MODEL || "";
    const model = configuredModel && !(args.resolution && /^gpt-image-2(?:-[24]k)?$/u.test(configuredModel)) ? configuredModel : undefined;
    let size = args.size;
    if (!size && /^gpt-image-2\.5-/u.test(model || "") && args.image_paths?.length) {
      const index = (args.aspect_source_image_index || 1) - 1;
      if (!Number.isInteger(index) || !args.image_paths[index]) throw new Error("参考图片序号无效");
      const dimensions = imageSize(await fs.readFile(args.image_paths[index]));
      size = `${dimensions.width}:${dimensions.height}`;
    }
    const request = { ...providerImageRequestFromArgs({ ...args, size, model }), imagePaths: args.image_paths, maskPath: args.mask_path };
    return createClient(options)[operation](request);
  };
  return { generate: args => invoke("generate", args), edit: args => invoke("edit", args) };
};
