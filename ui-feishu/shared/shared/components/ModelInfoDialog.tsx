import { useEffect, useRef, type ReactNode } from "react";
import styles from "./ModelInfoDialog.module.css";

export function ModelInfoDialog({ label, className, onClose, children }: {
  label: string; className: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);

  return <dialog ref={ref} className={`${styles.dialog} ${className}`} role="dialog" aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || event.detail === 0) return;
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose();
    }}>
    {children}
  </dialog>;
}
