// One execution policy for every user visible employee and delegated task.
// The working directory supplies context; it is not a filesystem permission
// boundary.  Native turn/start uses sandboxPolicy while thread calls use
// sandbox, so expose both forms explicitly.
export const executionPolicy = Object.freeze({ sandbox: "danger-full-access", approvalPolicy: "never" });
export const turnExecutionPolicy = Object.freeze({ sandboxPolicy: { type: "dangerFullAccess" }, approvalPolicy: "never" });
