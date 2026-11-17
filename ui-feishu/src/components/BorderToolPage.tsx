import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ArrowLeft, Download, ImagePlus, LoaderCircle, Upload } from 'lucide-react';
import styles from './BorderToolPage.module.css';

type OutputFormat = 'jpeg' | 'png';
type DownloadKind = 'default' | 'original';
type SelectedImage = {
  file: File;
  width: number;
  height: number;
  element: HTMLImageElement;
};

const DEFAULT_SIZE = { width: 1040, height: 1581 };
const PREVIEW_SIZE = { width: 640, height: 973 };
const MAX_OUTPUT_PIXELS = 4096 * 3072;
const PHOTO_WIDTH_RATIO = 0.9;

const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const centeredCrop = (width: number, height: number) => {
  if (width / height > 2 / 3) {
    const cropWidth = height * 2 / 3;
    return { x: (width - cropWidth) / 2, y: 0, width: cropWidth, height };
  }
  const cropHeight = width * 3 / 2;
  return { x: 0, y: (height - cropHeight) / 2, width, height: cropHeight };
};

const originalOutputSize = (width: number, height: number) => {
  const crop = centeredCrop(width, height);
  let outputWidth = Math.max(1, Math.round(crop.width / PHOTO_WIDTH_RATIO));
  let outputHeight = Math.max(1, Math.round(outputWidth * 76 / 50));
  const nominalPixels = outputWidth * outputHeight;
  if (nominalPixels <= MAX_OUTPUT_PIXELS) return { width: outputWidth, height: outputHeight, compressed: false };
  const scale = Math.sqrt(MAX_OUTPUT_PIXELS / nominalPixels);
  outputWidth = Math.floor(outputWidth * scale);
  outputHeight = Math.floor(outputWidth * 76 / 50);
  return { width: outputWidth, height: outputHeight, compressed: true };
};

const applyPrintProfile = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
  if (!context) return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const contrast = Array.from({ length: 256 }, (_, value) => Math.max(0, Math.min(255, 128 + (value - 128) * 1.03)));

  for (let index = 0; index < data.length; index += 4) {
    const r = contrast[data[index]];
    const g = contrast[data[index + 1]];
    const b = contrast[data[index + 2]];
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    const lightness = (max + min) / 2;
    let saturation = 0;
    let hue = 0;

    if (delta > 0) {
      saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
      else if (max === green) hue = ((blue - red) / delta + 2) * 60;
      else hue = ((red - green) / delta + 4) * 60;
    }

    const skin = hue >= 15 && hue <= 45 ? 0.03 : (hue >= 345 || hue <= 15) || (hue > 45 && hue <= 70) ? 0.02 : 0;
    if (skin && saturation > 0.06 && lightness > 0.06 && lightness < 0.97) {
      const nextSaturation = saturation * 0.96;
      const nextLightness = Math.min(1, lightness + skin);
      const chroma = (1 - Math.abs(2 * nextLightness - 1)) * nextSaturation;
      const section = hue / 60;
      const second = chroma * (1 - Math.abs(section % 2 - 1));
      let nextRed = 0;
      let nextGreen = 0;
      let nextBlue = 0;
      if (section < 1) [nextRed, nextGreen] = [chroma, second];
      else if (section < 2) [nextRed, nextGreen] = [second, chroma];
      else if (section < 3) [nextGreen, nextBlue] = [chroma, second];
      else if (section < 4) [nextGreen, nextBlue] = [second, chroma];
      else if (section < 5) [nextRed, nextBlue] = [second, chroma];
      else [nextRed, nextBlue] = [chroma, second];
      const match = nextLightness - chroma / 2;
      data[index] = Math.round((nextRed + match) * 255 * 0.95);
      data[index + 1] = Math.round((nextGreen + match) * 255);
      data[index + 2] = Math.round((nextBlue + match) * 255);
    } else {
      data[index] = Math.round(r * 0.95);
      data[index + 1] = g;
      data[index + 2] = b;
    }
  }
  context.putImageData(imageData, 0, 0);
};

const boxBlur = (source: Uint8ClampedArray, width: number, height: number, radius: number) => {
  const horizontal = new Uint8ClampedArray(source.length);
  const result = new Uint8ClampedArray(source.length);
  const diameter = radius * 2 + 1;
  const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value));

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += source[row + clamp(x, width - 1)];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = Math.round(sum / diameter);
      sum += source[row + clamp(x + radius + 1, width - 1)] - source[row + clamp(x - radius, width - 1)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) sum += horizontal[clamp(y, height - 1) * width + x];
    for (let y = 0; y < height; y += 1) {
      result[y * width + x] = Math.round(sum / diameter);
      sum += horizontal[clamp(y + radius + 1, height - 1) * width + x] - horizontal[clamp(y - radius, height - 1) * width + x];
    }
  }
  return result;
};

const softenDetail = (canvas: HTMLCanvasElement, high: number, midHigh: number) => {
  if (high <= 0 && midHigh <= 0) return;
  const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
  if (!context) return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const scale = Math.max(1, canvas.width / (DEFAULT_SIZE.width * PHOTO_WIDTH_RATIO));
  const smallRadius = Math.max(1, Math.round(scale * 0.8));
  const largeRadius = Math.max(smallRadius + 1, Math.round(scale * 2.4));
  const highStrength = high / 100;
  const midStrength = midHigh / 100;

  for (let channel = 0; channel < 3; channel += 1) {
    const plane = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let pixel = 0; pixel < plane.length; pixel += 1) plane[pixel] = data[pixel * 4 + channel];
    const small = boxBlur(plane, canvas.width, canvas.height, smallRadius);
    const large = boxBlur(plane, canvas.width, canvas.height, largeRadius);
    for (let pixel = 0; pixel < plane.length; pixel += 1) {
      const highDetail = plane[pixel] - small[pixel];
      const midDetail = small[pixel] - large[pixel];
      data[pixel * 4 + channel] = Math.max(0, Math.min(255, Math.round(plane[pixel] - highDetail * highStrength - midDetail * midStrength)));
    }
  }
  context.putImageData(imageData, 0, 0);
};

const renderBorderedImage = (image: HTMLImageElement, size: { width: number; height: number }, optimize: boolean, high: number, midHigh: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
  if (!context) throw new Error('当前浏览器无法创建图片画布。');

  const crop = centeredCrop(image.naturalWidth, image.naturalHeight);
  const photoWidth = Math.round(canvas.width * PHOTO_WIDTH_RATIO);
  const photoHeight = Math.round(photoWidth * 3 / 2);
  const photoX = (canvas.width - photoWidth) / 2;
  const photoY = canvas.height - photoHeight;
  const photo = document.createElement('canvas');
  photo.width = photoWidth;
  photo.height = photoHeight;
  const photoContext = photo.getContext('2d', { alpha: false, colorSpace: 'srgb' });
  if (!photoContext) throw new Error('当前浏览器无法处理图片。');
  photoContext.imageSmoothingEnabled = true;
  photoContext.imageSmoothingQuality = 'high';
  photoContext.fillStyle = '#fff';
  photoContext.fillRect(0, 0, photo.width, photo.height);
  photoContext.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, photo.width, photo.height);
  if (optimize) applyPrintProfile(photo);
  softenDetail(photo, high, midHigh);

  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI);
  context.translate(-canvas.width / 2, -canvas.height / 2);
  context.drawImage(photo, photoX, photoY);
  context.restore();
  return canvas;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function BorderToolPage({ onBack }: { onBack: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const loadId = useRef(0);
  const activeUrl = useRef('');
  const pendingUrl = useRef('');
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<DownloadKind | ''>('');
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [quality, setQuality] = useState(100);
  const [optimize, setOptimize] = useState(true);
  const [highDetailReduction, setHighDetailReduction] = useState(30);
  const [midDetailReduction, setMidDetailReduction] = useState(15);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cancelPending = () => {
    if (pendingUrl.current) URL.revokeObjectURL(pendingUrl.current);
    pendingUrl.current = '';
  };

  useEffect(() => () => {
    loadId.current += 1;
    cancelPending();
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
  }, []);

  const chooseFile = (file?: File) => {
    const id = ++loadId.current;
    cancelPending();
    if (!file) {
      setLoading(false);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setLoading(false);
      setError('请选择图片文件。');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    const url = URL.createObjectURL(file);
    pendingUrl.current = url;
    const element = new Image();
    element.decoding = 'async';
    element.onload = () => {
      if (id !== loadId.current) {
        if (pendingUrl.current === url) cancelPending();
        return;
      }
      pendingUrl.current = '';
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      activeUrl.current = url;
      setPreviewUrl('');
      setImage({ file, width: element.naturalWidth, height: element.naturalHeight, element });
    };
    element.onerror = () => {
      if (id !== loadId.current) return;
      cancelPending();
      setLoading(false);
      setError('图片读取失败，请换一张图片重试。');
    };
    element.src = url;
  };

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const preview = renderBorderedImage(image.element, PREVIEW_SIZE, optimize, highDetailReduction, midDetailReduction).toDataURL('image/jpeg', 0.82);
        if (!cancelled) {
          setPreviewUrl(preview);
          setError('');
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '图片处理失败，请换一张图片重试。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [image, optimize, highDetailReduction, midDetailReduction]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const download = async (kind: DownloadKind) => {
    if (!image || downloading) return;
    setDownloading(kind);
    setError('');
    setNotice('');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const planned = kind === 'default' ? { ...DEFAULT_SIZE, compressed: false }
        : originalOutputSize(image.width, image.height);
      const canvas = renderBorderedImage(image.element, planned, optimize, highDetailReduction, midDetailReduction);
      const type = format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, format === 'jpeg' ? quality / 100 : undefined));
      if (!blob) throw new Error('浏览器没有生成下载文件，请稍后重试。');
      const base = image.file.name.replace(/\.[^.]+$/, '') || 'photo';
      downloadBlob(blob, `${base}-白边-${planned.width}x${planned.height}.${format === 'png' ? 'png' : 'jpg'}`);
      const result = `已生成 ${format === 'png' ? 'PNG' : 'JPEG'}（${formatSize(blob.size)}）并开始下载。`;
      setNotice(kind === 'original' && planned.compressed ? `原始分辨率成品超过安全范围，已压缩后下载。${result}` : result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片生成失败，请重试。');
    } finally {
      setDownloading('');
    }
  };

  const sourcePixels = image ? image.width * image.height : 0;
  const originalPlan = image ? originalOutputSize(image.width, image.height) : null;
  const largeSource = sourcePixels > MAX_OUTPUT_PIXELS;
  const ratio = image ? `${(image.width / image.height).toFixed(2)} : 1` : '';
  const changeOptimize = (enabled: boolean) => {
    setOptimize(enabled);
    setNotice('');
  };

  return <section className={styles.page} aria-labelledby="border-tool-title">
    <header className={styles.header}>
      <button className="icon-button" type="button" aria-label="返回消息" title="返回消息" onClick={onBack}><ArrowLeft size={18} /></button>
      <div><h1 id="border-tool-title">增加边框</h1><p>居中裁剪为 2:3，添加白边并旋转 180°，用于米家口袋打印机 Pro。</p></div>
    </header>

    <div className={styles.workspace}>
      <section className={styles.card} aria-labelledby="border-preview-title">
        <div className={styles.cardHeading}><h2 id="border-preview-title">成品预览</h2>{image ? <button type="button" className={styles.textButton} onClick={() => input.current?.click()}>更换图片</button> : null}</div>
        <input ref={input} hidden type="file" accept="image/*" onChange={choose} />
        {image && previewUrl
          ? <div
            className={`${styles.preview} ${dragging ? styles.dragging : ''}`}
            aria-busy={loading}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <img src={previewUrl} alt="增加白边并旋转后的成品预览" />
            {loading ? <span className={styles.previewStatus}><LoaderCircle className={styles.spinning} size={17} />正在生成新预览…</span> : null}
          </div>
          : <div
            className={`${styles.dropzone} ${dragging ? styles.dragging : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') input.current?.click(); }}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            {loading ? <LoaderCircle className={styles.spinning} size={34} /> : <ImagePlus size={34} />}
            <strong>{loading ? '正在生成预览…' : '选择或拖入一张图片'}</strong>
            <span>自动居中裁剪为 2:3，照片、桌面和手机均可直接选择</span>
          </div>}
        {!image ? <button type="button" className={styles.uploadButton} onClick={() => input.current?.click()}><Upload size={16} />上传图片</button> : null}
        {image ? <dl className={styles.meta}>
          <div><dt>文件名</dt><dd title={image.file.name}>{image.file.name}</dd></div>
          <div><dt>原图分辨率</dt><dd>{image.width} × {image.height}</dd></div>
          <div><dt>原图大小</dt><dd>{formatSize(image.file.size)}</dd></div>
          <div><dt>原图比例</dt><dd>{ratio}</dd></div>
        </dl> : null}
      </section>

      <section className={styles.card} aria-labelledby="border-output-title">
        <div className={styles.cardHeading}><h2 id="border-output-title">下载设置</h2><span className={styles.badge}>sRGB</span></div>
        <div className={styles.setting}>
          <label htmlFor="border-format">文件格式</label>
          <select id="border-format" value={format} onChange={event => { setFormat(event.target.value as OutputFormat); setNotice(''); }}>
            <option value="jpeg">JPEG（推荐打印）</option>
            <option value="png">PNG（无损）</option>
          </select>
        </div>
        <div className={styles.setting}>
          <label htmlFor="border-quality">JPEG 质量 <strong>{quality}%</strong></label>
          <input id="border-quality" type="range" min="60" max="100" step="1" value={quality} disabled={format !== 'jpeg'} onChange={event => { setQuality(Number(event.target.value)); setNotice(''); }} />
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" checked={optimize} onChange={event => changeOptimize(event.target.checked)} />
          <span><strong>打印色彩优化</strong><small>轻微对比度、肤色提亮、R 通道降低 5% 和暖色降饱和</small></span>
        </label>
        <details className={styles.details}>
          <summary>细节柔化<span>高频 {highDetailReduction}% · 中高频 {midDetailReduction}%</span></summary>
          <div className={styles.detailBody}>
            <div className={styles.setting}>
              <label htmlFor="high-detail">高频细节柔化 <strong>{highDetailReduction}%</strong></label>
              <input id="high-detail" type="range" min="0" max="100" step="5" value={highDetailReduction} onChange={event => { setHighDetailReduction(Number(event.target.value)); setNotice(''); }} />
            </div>
            <div className={styles.setting}>
              <label htmlFor="mid-detail">中高频细节柔化 <strong>{midDetailReduction}%</strong></label>
              <input id="mid-detail" type="range" min="0" max="100" step="5" value={midDetailReduction} onChange={event => { setMidDetailReduction(Number(event.target.value)); setNotice(''); }} />
            </div>
            <p>降低打印机降采样后产生的过度锐利感；设为 0 可关闭对应处理。</p>
          </div>
        </details>
        <p className={styles.outputSummary}>默认成品：<strong>{DEFAULT_SIZE.width} × {DEFAULT_SIZE.height}</strong><br />照片区域保持 2:3，左右白边等宽、下方白边较宽、上方无额外白边。</p>
        {largeSource || originalPlan?.compressed ? <p className={styles.warning}>
          {largeSource ? `原图约 ${(sourcePixels / 1_000_000).toFixed(1)} MP，超过普通手机 4096 × 3072 的安全范围。` : ''}
          {originalPlan?.compressed ? `原始分辨率成品将压缩至约 ${originalPlan.width} × ${originalPlan.height}。` : '裁剪后成品已在安全范围内。'}
        </p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        <div className={styles.downloads}>
          <button type="button" className={styles.primaryButton} disabled={!image || Boolean(downloading)} onClick={() => void download('default')}>
            {downloading === 'default' ? <LoaderCircle className={styles.spinning} size={17} /> : <Download size={17} />}
            {downloading === 'default' ? '正在生成…' : `下载默认尺寸 ${DEFAULT_SIZE.width} × ${DEFAULT_SIZE.height}`}
          </button>
          <button type="button" className={styles.downloadButton} disabled={!image || Boolean(downloading)} onClick={() => void download('original')}>
            {downloading === 'original' ? <LoaderCircle className={styles.spinning} size={17} /> : <Download size={17} />}
            {downloading === 'original' ? '正在生成…' : originalPlan?.compressed
              ? `下载原始分辨率（压缩至 ${originalPlan.width} × ${originalPlan.height}）`
              : `下载原始分辨率 ${originalPlan ? `${originalPlan.width} × ${originalPlan.height}` : ''}`}
          </button>
        </div>
        <p className={styles.footnote}>不包含实体相纸自带的 14mm 白边。图片只在当前设备本地处理。</p>
      </section>
    </div>
  </section>;
}
