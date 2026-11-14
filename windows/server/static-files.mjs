import fs from "node:fs/promises";
import path from "node:path";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"],
]);

// There is one frontend build now. Keep old bookmarks usable by routing them
// into the matching settings section instead of serving another HTML app.
const legacyRedirects = new Map([
  ["/group.html", "/?view=group"],
  ["/employee.html", "/?view=employees"],
  ["/progress.html", "/?view=settings&settings=progress"],
  ["/progress", "/?view=settings&settings=progress"],
  ["/progress/", "/?view=settings&settings=progress"],
  ["/project-management.html", "/?view=settings&settings=management"],
  ["/project-management", "/?view=settings&settings=management"],
  ["/project-management/", "/?view=settings&settings=management"],
]);

export const createStaticFileServer = (webRoot) => async (url, response) => {
  const legacyTarget = legacyRedirects.get(url.pathname);
  if (legacyTarget) {
    const location = new URL(legacyTarget, url.origin);
    for (const [key, value] of url.searchParams) {
      if (!location.searchParams.has(key)) location.searchParams.set(key, value);
    }
    if (url.pathname === "/employee.html" && url.searchParams.get("employeeId") && !location.searchParams.has("agent")) {
      location.searchParams.set("agent", url.searchParams.get("employeeId"));
    }
    response.writeHead(302, { Location: `${location.pathname}${location.search}`, "Cache-Control": "no-store" });
    response.end();
    return;
  }
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.resolve(webRoot, relative);
  if (file !== webRoot && !file.startsWith(`${webRoot}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await fs.readFile(file);
    const fileName = path.basename(file).toLowerCase();
    const needsRevalidation = file.endsWith(".html")
      || fileName === "sw.js"
      || fileName === "manifest.webmanifest";
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(file).toLowerCase()) || "application/octet-stream",
      "Cache-Control": needsRevalidation ? "no-cache" : "public, max-age=31536000, immutable",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not Found");
  }
};
