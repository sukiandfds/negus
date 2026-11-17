import { useEffect, useRef } from "react";

type DismissibleLayerOptions = {
  active: boolean;
  onDismiss: () => void;
  isInside?: (target: EventTarget | null) => boolean;
  restoreFocus?: () => void;
};

/**
 * Shared outside-click and Escape handling for transient menus and popovers.
 * The predicate lets callers keep portals or trigger buttons inside the layer.
 */
export function useDismissibleLayer({ active, onDismiss, isInside, restoreFocus }: DismissibleLayerOptions) {
  const onDismissRef = useRef(onDismiss);
  const isInsideRef = useRef(isInside);
  const restoreFocusRef = useRef(restoreFocus);
  onDismissRef.current = onDismiss;
  isInsideRef.current = isInside;
  restoreFocusRef.current = restoreFocus;

  useEffect(() => {
    if (!active) return;
    const closeOutside = (event: PointerEvent) => {
      if (!isInsideRef.current?.(event.target)) onDismissRef.current();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onDismissRef.current();
      restoreFocusRef.current?.();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [active]);
}
