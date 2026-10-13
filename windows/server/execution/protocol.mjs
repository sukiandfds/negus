// App-server and multi-agent execution streams use the same terminal phases.
// Keep this contract in one place so a new terminal state cannot leave one
// surface polling forever while the other considers it finished.
export const terminalPhases = new Set(["completed", "failed", "interrupted", "systemError"]);
