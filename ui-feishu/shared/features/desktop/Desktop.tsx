import { EditableDesktop } from "./EditableDesktop";
import type { ComponentProps } from "react";

export function Desktop(props: ComponentProps<typeof EditableDesktop>) {
  return <EditableDesktop {...props} />;
}
