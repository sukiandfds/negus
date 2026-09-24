import { Bot, House, MessagesSquare } from "lucide-react";
import type { MouseEvent } from "react";
import { surfaceHref, type ViewSurface } from "../ViewSwitcher/ViewSwitcher";
import styles from "./BottomNav.module.css";

const items = [
  { id: "desktop", label: "桌面", title: "回到桌面", icon: House },
  { id: "conversation", label: "会话", title: "最近的会话", icon: Bot },
  { id: "group", label: "群聊", title: "项目群聊", icon: MessagesSquare },
] as const;

export function BottomNav({ current, onViewChange }: {
  current: Exclude<ViewSurface, "progress">;
  onViewChange?: (surface: Exclude<ViewSurface, "progress">) => void;
}) {
  const handleView = (surface: (typeof items)[number]["id"]) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onViewChange || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onViewChange(surface);
    if (surface === "conversation") window.dispatchEvent(new Event("negus:open-latest-conversation"));
  };
  return (
    <nav className={styles.dock} aria-label="切换页面">
      {items.map((item) => {
        const Icon = item.icon;
        const active = current === item.id;
        return (
          <a
            key={item.id}
            className={active ? styles.active : undefined}
            href={surfaceHref(item.id)}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            title={item.title}
            onClick={handleView(item.id)}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
