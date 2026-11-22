import type { SessionMessage } from "./types";

export const switchingTo = (model: string) => ({ modelSwitch: model, modelSwitchState: "switching" as const });
export const switchedTo = (model: string) => ({ modelSwitch: model, modelSwitchState: undefined });
export const settleSwitch = (message: Pick<SessionMessage, "modelSwitchState"> | undefined, failed: boolean) =>
  message?.modelSwitchState === "switching" ? { modelSwitchState: failed ? "failed" as const : undefined } : {};
