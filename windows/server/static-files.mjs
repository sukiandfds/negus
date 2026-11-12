import fs from "node:fs/promises";
import path from "node:path";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
]);

const pageAliases = new Map([
  ["/", "index.html"],
  ["/group", "group.html"],
  ["/progress", "project-management.html"],
  ["/project-management", "project-management.html"],
]);

// Only fingerprinted build output may be cached forever; pages, the service
// worker and the manifest must be revalidated so a new build is picked up.
const cacheControlFor = (file) => file.includes(`${path.sep}assets${path.sep}`)
  ? "public, max-age=31536000, immutable"
  : "no-cache";

const sendText = (response, status, text) => {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
};

export const createStaticFileServer = (webRoot) => {
  const root = path.resolve(webRoot);
  return async (url, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendText(response, 400, "Bad Request");
      return;
    }
    const alias = pageAliases.get(pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname);
    const file = path.resolve(root, alias || pathname.replace(/^\/+/u, ""));
    if (!file.startsWith(`${root}${path.sep}`)) {
      sendText(response, 403, "Forbidden");
      return;
    }
    try {
      const content = await fs.readFile(file);
      response.writeHead(200, {
        "Content-Type": mimeTypes.get(path.extname(file).toLowerCase()) || "application/octet-stream",
        "Cache-Control": cacheControlFor(file),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      response.end(content);
    } catch {
      sendText(response, 404, "Not Found");
    }
  };
};
