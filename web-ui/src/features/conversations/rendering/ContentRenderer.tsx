import { createContext, useContext, Children, isValidElement, forwardRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, ImageOff, X } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContentBlock, ImageBlock, SessionMessage } from "../model/types";
import { withAccessToken } from "../../../shared/api/http";
import styles from "./ContentRenderer.module.css";
import { CodeBlock } from "../../../shared/components/CodeBlock";

import { conversationQuery } from "../../../shared/api/conversationScope";

const FileLinkContext = createContext<{ threadId: string; messageId: string } | null>(null);

const IMAGE_VIEWER_HISTORY_KEY = "codexImageViewer";

interface ImageDimensions { width: number; height: number }

const imageDimensionsCache = new Map<string, ImageDimensions>();

function validDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function getSourceDimensions(source: string): ImageDimensions | null {
  try {
    const url = new URL(source, "http://local");
    const width = Number(url.searchParams.get("w"));
    const height = Number(url.searchParams.get("h"));
    return validDimension(width) && validDimension(height) ? { width, height } : null;
  } catch {
    return null;
  }
}

function rememberImageDimensions(source: string, dimensions: ImageDimensions) {
  if (imageDimensionsCache.size >= 200) {
    const oldest = imageDimensionsCache.keys().next().value;
    if (oldest) imageDimensionsCache.delete(oldest);
  }
  imageDimensionsCache.set(source, dimensions);
}

type ImageLayout = "default" | "gallery" | "single";

function RenderedImage({
  source,
  alt,
  width,
  height,
  layout = "default",
}: {
  source: string;
  alt: string;
  width?: number;
  height?: number;
  layout?: ImageLayout;
}) {
  const url = withAccessToken(source);
  const thumbnailUrl = withAccessToken(source, source.startsWith("/api/media/") ? { preview: "1" } : undefined);
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(() => {
    if (validDimension(width) && validDimension(height)) return { width, height };
    return getSourceDimensions(source) || imageDimensionsCache.get(source) || null;
  });
  const [failed, setFailed] = useState(!source);
  const [isOpen, setIsOpen] = useState(false);
  const imageClass = failed ? styles.imageFailed : dimensions ? styles.imageReady : styles.imagePending;
  const layoutClass = layout === "gallery" ? styles.galleryImage : layout === "single" ? styles.singleImage : "";

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const requestClose = () => {
      if (window.history.state?.[IMAGE_VIEWER_HISTORY_KEY]) window.history.back();
      else setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    const handlePopState = () => setIsOpen(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
      if (window.history.state?.[IMAGE_VIEWER_HISTORY_KEY]) {
        const nextState = { ...window.history.state };
        delete nextState[IMAGE_VIEWER_HISTORY_KEY];
        window.history.replaceState(nextState, "");
      }
    };
  }, [isOpen]);

  const openViewer = () => {
    if (failed) return;
    window.history.pushState({ ...window.history.state, [IMAGE_VIEWER_HISTORY_KEY]: true }, "");
    setIsOpen(true);
  };

  const closeViewer = () => {
    if (window.history.state?.[IMAGE_VIEWER_HISTORY_KEY]) window.history.back();
    else setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={`${styles.imageThumbnail} ${imageClass} ${layoutClass}`}
        onClick={openViewer}
        aria-label={failed ? "图片无法显示" : `查看大图${alt ? `：${alt}` : ""}`}
        disabled={failed}
      >
        {!failed ? (
          <img
            src={thumbnailUrl}
            alt={alt}
            loading="lazy"
            width={dimensions?.width}
            height={dimensions?.height}
            onLoad={(event) => {
              setFailed(false);
              if (dimensions) return;
              const next = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              };
              if (!validDimension(next.width) || !validDimension(next.height)) return;
              rememberImageDimensions(source, next);
              setDimensions(next);
            }}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className={styles.imageError}><ImageOff aria-hidden="true" />图片无法显示</span>
        )}
      </button>
      {isOpen && createPortal(
        <div className={styles.imageViewer} role="dialog" aria-modal="true" aria-label={alt || "查看大图"} onClick={closeViewer}>
          <button
            type="button"
            className={styles.imageViewerClose}
            onClick={(event) => {
              event.stopPropagation();
              closeViewer();
            }}
            aria-label="关闭大图"
            title="关闭"
            autoFocus
          >
            <X aria-hidden="true" />
          </button>
          <img src={url} alt={alt} onClick={(event) => event.stopPropagation()} />
        </div>,
        document.body,
      )}
    </>
  );
}

const markdownComponents: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  img: ({ src, alt }) => <RenderedImage source={src || ""} alt={alt || ""} />,
};

function MarkdownCode({ children, collapsible = true }: { children?: ReactNode; collapsible?: boolean }) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ children?: ReactNode; className?: string }>(child) || typeof child.props.children !== "string") return <pre>{children}</pre>;
  return <CodeBlock text={child.props.children} language={child.props.className?.replace(/^language-/, "") || ""} collapsible={collapsible} />;
}

const conversationMarkdownComponents: Components = { ...markdownComponents, pre: MarkdownCode };
const expandedMarkdownComponents: Components = { ...markdownComponents, pre: ({ children }) => <MarkdownCode collapsible={false}>{children}</MarkdownCode> };

export const MarkdownContent = forwardRef<HTMLDivElement, { text: string; className?: string; style?: CSSProperties; codeBlocks?: boolean; collapseCode?: boolean }>(function MarkdownContent({ text, className, style, codeBlocks = false, collapseCode = true }, ref) {
  const scope = useContext(FileLinkContext);
  const urlTransform = (url: string, key: string) => {
    if (key !== "href" || !scope?.threadId || /^(?:https?:|mailto:|tel:|#|\/\/|\/api\/)/i.test(url)) return defaultUrlTransform(url);
    if (/^(?!file:|[a-z]:[\\/])[a-z][a-z0-9+.-]*:/i.test(url)) return defaultUrlTransform(url);
    const query = new URLSearchParams({ threadId: scope.threadId, messageId: scope.messageId, href: url });
    return withAccessToken("/api/session/file?" + query + conversationQuery());
  };
  return <div ref={ref} className={className} style={style}><ReactMarkdown urlTransform={urlTransform} remarkPlugins={[remarkGfm]} components={codeBlocks ? collapseCode ? conversationMarkdownComponents : expandedMarkdownComponents : markdownComponents}>{text}</ReactMarkdown></div>;
});

export function CollapsedMarkdown({ text, lines = 2, characterLimit }: { text: string; lines?: number; characterLimit?: number }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const collapsedStyle = { "--clamp-lines": String(lines) } as CSSProperties;
  const characters = characterLimit === undefined ? [] : Array.from(text);
  let count = 0;
  const cutoff = characters.findIndex((character) => character !== "\n" && character !== "\r" && ++count > (characterLimit ?? Infinity));
  const characterOverflow = cutoff >= 0;
  const preview = characterOverflow ? characters.slice(0, cutoff).join("") + "…" : text;

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element || expanded || characterLimit !== undefined) return;
    setOverflowing(element.scrollHeight > element.clientHeight + 1);
  }, [expanded, lines, text, characterLimit]);

  return (
    <div>
      <MarkdownContent
        ref={contentRef}
        text={characterLimit !== undefined && !expanded ? preview : text}
        codeBlocks={characterLimit !== undefined && (!characterOverflow || expanded)}
        collapseCode={false}
        className={expanded || characterLimit !== undefined ? styles.content : `${styles.content} ${styles.clamp}`}
        style={expanded || characterLimit !== undefined ? undefined : collapsedStyle}
      />
      {(characterLimit !== undefined ? characterOverflow : overflowing) ? (
        <button type="button" className={styles.expand} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : characterLimit !== undefined ? "展开" : "显示更多"}
        </button>
      ) : null}
    </div>
  );
}

function ImageGallery({ blocks }: { blocks: ImageBlock[] }) {
  const single = blocks.length === 1;
  return (
    <div className={`${styles.imageGallery} ${single ? styles.imageGallerySingle : ""}`}>
      {blocks.map((block) => (
        <RenderedImage
          key={block.id}
          source={block.source}
          alt={block.alt || block.file?.name || "对话图片"}
          width={block.width || block.file?.width}
          height={block.height || block.file?.height}
          layout={single ? "single" : "gallery"}
        />
      ))}
    </div>
  );
}

function Block({ block }: { block: ContentBlock }) {
  if (block.type === "markdown") {
    return <MarkdownContent text={block.text} codeBlocks />;
  }
  if (block.type === "options") {
    return <div className={styles.options}>{block.options.map((option) => <div key={option}>{option}</div>)}</div>;
  }
  if (block.type === "image") {
    return (
      <RenderedImage
        source={block.source}
        alt={block.alt || block.file?.name || "对话图片"}
        width={block.width || block.file?.width}
        height={block.height || block.file?.height}
      />
    );
  }
  if (block.type === "audio") return <audio className={styles.audio} controls preload="metadata" src={withAccessToken(block.source)} />;
  if (block.type === "video") return <video className={styles.video} controls preload="metadata" src={withAccessToken(block.source)} />;

  const name = block.name || block.file?.name || "附件";
  const readStatus = block.file?.readStatus === "ready"
    ? "已读取"
    : block.file?.readStatus === "native"
      ? "原生附件"
      : block.file?.readStatus === "unsupported"
        ? "暂未解析"
        : block.file?.readStatus === "failed"
          ? "读取失败"
          : "";
  return (
    <div className={styles.file}>
      <FileText aria-hidden="true" />
      <span>{name}</span>
      {readStatus ? <small className={styles.fileStatus} title={block.file?.readError || readStatus}>{readStatus}</small> : null}
      <a href={withAccessToken(block.source, { download: "1" })} aria-label={`下载 ${name}`} title={`下载 ${name}`}>
        <Download aria-hidden="true" />
      </a>
    </div>
  );
}

export function ContentRenderer({ message, threadId = "" }: { message: SessionMessage; threadId?: string }) {
  const blocks = message.blocks?.length
    ? message.blocks
    : [{ id: `${message.id}-text`, type: "markdown" as const, text: message.text }];
  const content = [];
  // One budget for the user's complete text, even when native input splits it
  // into multiple text blocks. Media stays outside the collapsible text.
  const userText = message.role === "user" ? blocks.filter((block) => block.type === "markdown").map((block) => block.text).join("\n") : "";
  let renderedUserText = false;
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    if (message.role === "user" && block.type === "markdown") {
      if (!renderedUserText) content.push(<CollapsedMarkdown key={`${message.id}-text`} text={userText} characterLimit={500} />);
      renderedUserText = true;
      index += 1;
      continue;
    }
    if (block.type !== "image") {
      content.push(<Block key={block.id} block={block} />);
      index += 1;
      continue;
    }

    const images: ImageBlock[] = [];
    while (index < blocks.length && blocks[index].type === "image") {
      images.push(blocks[index] as ImageBlock);
      index += 1;
    }
    content.push(<ImageGallery key={`gallery-${images[0].id}`} blocks={images} />);
  }
  return <FileLinkContext.Provider value={{ threadId, messageId: message.id }}><div className={styles.content}>{content}</div></FileLinkContext.Provider>;
}
