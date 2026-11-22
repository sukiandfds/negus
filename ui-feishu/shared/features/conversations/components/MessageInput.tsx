import type { ComponentPropsWithRef } from "react";

type Props = Omit<ComponentPropsWithRef<"textarea">, "onPaste" | "onSubmit"> & {
  onFiles?: (files: FileList) => void;
  submit: () => Promise<void>;
};

export function MessageInput({ onFiles, submit, onKeyDown, ...props }: Props) {
  return <textarea rows={2} {...props} onPaste={event => {
    if (!onFiles || !event.clipboardData.files.length) return;
    event.preventDefault();
    onFiles(event.clipboardData.files);
  }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    onKeyDown?.(event);
    if (!event.defaultPrevented && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }} />;
}
