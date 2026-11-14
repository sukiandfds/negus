import { useEffect, useState } from "react";
import styles from "./LiveClock.module.css";

export function LiveClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const date = new Intl.DateTimeFormat("zh-CN", { timeZone, year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now);

  return <div className={styles.clock} aria-label={`${date} ${time} 北京时间`}>
    <div className={styles.date}>{date}</div>
    <time className={styles.time} dateTime={now.toISOString()}>{time}</time>
    <div className={styles.zone}>北京时间</div>
  </div>;
}
