import { ChevronDown } from "lucide-react";
import styles from "./JumpToLatest.module.css";

export function JumpToLatest({ visible, className = "", label = "回到底部", onClick }: {
  visible: boolean;
  className?: string;
  label?: string;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <button className={`${styles.button} ${className}`} type="button" onClick={onClick}>
      <ChevronDown aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
