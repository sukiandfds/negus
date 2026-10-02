export const imageModelByResolution = Object.freeze({
  "1K": "gpt-image-2",
  "2K": "gpt-image-2-2k",
  "4K": "gpt-image-2-4k",
});

const resolutionByImageModel = Object.freeze(Object.fromEntries(
  Object.entries(imageModelByResolution).map(([resolution, model]) => [model, resolution]),
));
const longEdgeByResolution = Object.freeze({ "1K": 1920, "2K": 2560, "4K": 3840 });
const providerAspectRatios = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]);

export const normalizeImageResolution = (value, fallback = "1K") => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized in imageModelByResolution ? normalized : fallback;
};

export const modelForImageResolution = (value) => imageModelByResolution[normalizeImageResolution(value)];

const resolutionFromPixelSize = (value) => {
  const normalized = String(value || "").trim().replace(/[×＊*]/gu, "x").replace(/\s+/gu, "");
  const pixels = /^(\d{2,4})[xX](\d{2,4})$/u.exec(normalized);
  if (!pixels) return undefined;
  const longEdge = Math.max(Number(pixels[1]), Number(pixels[2]));
  if (longEdge > 2560) return "4K";
  if (longEdge > 1920) return "2K";
  return "1K";
};

const resolutionForArgs = (args) => normalizeImageResolution(
  args.resolution,
  resolutionByImageModel[String(args.model || "").trim()] || resolutionFromPixelSize(args.size) || "1K",
);

export const imageResolutionForModel = (value) => (
  resolutionByImageModel[String(value || "").trim()] || "1K"
);

const roundedDimension = (value) => Math.max(64, Math.min(4096, Math.round(value / 16) * 16));

export const normalizeProviderImageSize = (value, resolution = "1K") => {
  const normalized = String(value || "").trim()
    .replace(/[：﹕]/gu, ":")
    .replace(/[×＊*]/gu, "x")
    .replace(/\s+/gu, "");
  if (!normalized) return undefined;

  const pixels = /^(\d{2,4})[xX](\d{2,4})$/u.exec(normalized);
  if (pixels) {
    const width = Number(pixels[1]);
    const height = Number(pixels[2]);
    if (width >= 64 && width <= 4096 && height >= 64 && height <= 4096) return `${width}x${height}`;
    throw new Error("Image size must keep each side between 64 and 4096 pixels");
  }

  const ratio = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(normalized);
  if (!ratio) throw new Error(`Unsupported image size or aspect ratio: ${value}`);
  const left = Number(ratio[1]);
  const right = Number(ratio[2]);
  if (!(left > 0) || !(right > 0)) throw new Error(`Invalid image aspect ratio: ${value}`);

  const canonical = `${left}:${right}`;
  if (providerAspectRatios.has(canonical)) return canonical;
  const aspect = left / right;
  const longEdge = longEdgeByResolution[normalizeImageResolution(resolution)];
  const width = aspect >= 1 ? longEdge : roundedDimension(longEdge * aspect);
  const height = aspect >= 1 ? roundedDimension(longEdge / aspect) : longEdge;
  return `${width}x${height}`;
};

// Sunburst/Flare use one model ID across resolutions; ratio alone defaults to 1K upstream.
export const normalizeImageModelSize = (value, resolution, model) => {
  if (!/^gpt-image-2\.5-(sunburst|flare)$/u.test(model || "")) return normalizeProviderImageSize(value, resolution);
  const normalized = normalizeProviderImageSize(value, resolution);
  if (!normalized) return resolution ? `${resolution}:1:1` : undefined;
  if (normalized.includes(":")) return `${resolution || "1K"}:${normalized}`;
  let [width, height] = normalized.split("x").map(Number);
  const explicitPixels = /^\d+[xX×＊*]\d+$/u.test(String(value || "").replace(/\s+/gu, ""));
  if (!explicitPixels && width * height > 8294400) {
    const scale = Math.sqrt(8294400 / (width * height));
    width = Math.floor(width * scale / 16) * 16;
    height = Math.floor(height * scale / 16) * 16;
  }
  const pixels = width * height;
  if (width % 16 || height % 16 || Math.max(width, height) > 3840 || Math.max(width / height, height / width) > 3 || pixels < 655360 || pixels > 8294400)
    throw new Error("GPT Image 2.5 尺寸须为 16 的倍数、单边不超过 3840、比例不超过 3:1、总像素在 655360–8294400 之间");
  return `${width}x${height}`;
};

export const providerImageRequestFromArgs = (args = {}) => {
  const resolution = resolutionForArgs(args);
  const model = args.model || modelForImageResolution(resolution);
  if (args.quality && !["auto", "low", "medium", "high", ...(/^gpt-image-2\.5-/u.test(model) ? ["xhigh", "max"] : [])].includes(args.quality)) throw new Error("当前图片模型不支持该质量档位");
  return {
    prompt: args.prompt,
    model,
    size: args.size || args.resolution ? normalizeImageModelSize(args.size, resolution, model) : undefined,
    n: args.n,
    quality: args.quality,
    targetSize: args.target_size || args.targetSize,
    aspectSourceImageIndex: args.aspect_source_image_index || args.aspectSourceImageIndex,
    outputDirectory: args.output_directory || args.outputDirectory,
    outputName: args.output_name || args.outputName,
  };
};
