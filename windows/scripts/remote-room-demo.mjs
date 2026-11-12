import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createJsonlConversationStore } from "../server/jsonl-conversation-store.mjs";
import { createAppServerConversationStore } from "../server/app-server-conversation-store.mjs";
import { createConversationService } from "../server/conversation-service.mjs";
import { createConversationVersionStore } from "../server/conversation-version-store.mjs";
import { createMediaService } from "../server/media-service.mjs";
import { createRealtimeHub } from "../server/realtime-hub.mjs";
import { createExecutionTracker } from "../server/execution-tracker.mjs";
import { createContextManagementService } from "../server/context-management-service.mjs";
import { minimumStrongTokenLength, resolveAccessToken } from "../server/http/access-control.mjs";
import { createRequestHandler } from "../server/request-handler.mjs";
import { createStaticFileServer } from "../server/static-files.mjs";
import { createWebVersionReader } from "../server/web-version.mjs";
import { createGroupRoomStore } from "../server/group-room-store.mjs";
import { createMultiAgentService } from "../server/multi-agent-service.mjs";
import { createArtifactService } from "../server/artifact-service.mjs";
import { createWebOutputService } from "../server/web-output-service.mjs";
import { createFushengUsageService } from "../server/fusheng-usage-service.mjs";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const port = Number(getArg("--port", "9360"));
const host = getArg("--host", "0.0.0.0");
const observerPort = Number(getArg("--observer-port", "9350"));
const project = getArg("--project", "codex-collab-panel-demo");
const projectRoot = path.resolve(getArg("--project-root", process.cwd()));
const webRoot = path.resolve(getArg("--web-root", path.join(process.cwd(), "web-ui", "dist")));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[remote-room-demo] invalid --port: ${getArg("--port", "")}`);
  process.exit(1);
}
const { token, source: tokenSource } = resolveAccessToken({
  explicitToken: getArg("--token", ""),
  tokenFile: path.join(projectRoot, "runtime", "access-token"),
});
const loopbackOnly = ["127.0.0.1", "::1", "localhost"].includes(host);
const deviceName = String(getArg("--device-name", os.hostname())).trim() || os.hostname();
const device = { name: deviceName, startedAt: new Date().toISOString() };
const sessionRoot = process.env.CODEX_SESSION_DIR || path.join(os.homedir(), ".codex", "sessions");
const media = createMediaService({ uploadRoot: path.join(projectRoot, "runtime", "uploads") });
await media.restoreUploads();
const realtime = createRealtimeHub();
const execution = createExecutionTracker({
  broadcast: realtime.broadcast,
  stateFile: path.join(projectRoot, "runtime", "execution-runs.json"),
});
let contextManagement;
const jsonlConversations = createJsonlConversationStore({
  sessionRoot,
  projectRoot,
  registerMedia: media.register,
  onChange: realtime.broadcast,
});
const appServerConversations = createAppServerConversationStore({
  projectRoot,
  registerMedia: media.register,
  onProtocolMessage: (message) => {
    execution.handleProtocolMessage(message);
    contextManagement?.handleProtocolMessage(message);
  },
  onSubmitted: execution.markSubmitted,
  onFailed: execution.markFailed,
  onHealthState: execution.handleHealthState,
});
const conversationVersions = createConversationVersionStore({
  stateFile: path.join(projectRoot, "runtime", "conversation-versions.json"),
});
const conversations = createConversationService({
  primary: appServerConversations,
  fallback: jsonlConversations,
  contentVersionStore: conversationVersions,
});
contextManagement = await createContextManagementService({
  stateFile: path.join(projectRoot, "runtime", "context-settings.json"),
  broadcast: realtime.broadcast,
  getExecutionStatus: execution.getStatus,
  getRuntimeContext: conversations.getRuntimeContext,
  compactContext: conversations.compactContext,
});
const groupRoom = await createGroupRoomStore({
  stateFile: path.join(projectRoot, "runtime", "group-room.json"),
  project,
  broadcast: realtime.broadcast,
});
const artifacts = await createArtifactService({
  stateFile: path.join(projectRoot, "runtime", "artifacts.json"),
  allowedRoot: path.join(projectRoot, "runtime", "agent-artifacts"),
  projectId: project,
  media,
  broadcast: realtime.broadcast,
});
const webOutputs = createWebOutputService({
  projectRoot,
  originBaseUrl: `http://127.0.0.1:${port}`,
  artifacts,
  media,
});
const multiAgent = createMultiAgentService({
  projectRoot,
  room: groupRoom,
  broadcast: realtime.broadcast,
  webOutputs,
});
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const fushengUsage = createFushengUsageService({
  credentialsFile: path.join(localAppData, "FushengUsageMonitor", "credentials.json"),
});

const serveStatic = createStaticFileServer(webRoot);
const readWebVersion = createWebVersionReader(webRoot);
const requestHandler = createRequestHandler({
  token, project, projectRoot, device, observerPort, conversations, execution, media, realtime,
  contextManagement, groupRoom, multiAgent, artifacts, webOutputs, fushengUsage, readWebVersion, serveStatic,
});
const server = http.createServer(requestHandler);

// One rejected promise in a background task must not take down the service
// and every turn it is supervising.
process.on("unhandledRejection", (reason) => {
  console.error("[remote-room-demo] unhandled rejection:", reason);
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  // If a state file cannot be flushed, still exit instead of hanging.
  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();
  realtime.close();
  conversations.close();
  multiAgent.close();
  webOutputs.close();
  server.close();
  server.closeAllConnections?.();
  await Promise.allSettled([execution.close(), contextManagement.close(), artifacts.close(), groupRoom.close()]);
  process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);

server.once("error", (error) => {
  console.error(error.code === "EADDRINUSE"
    ? `[remote-room-demo] port ${port} is already in use`
    : `[remote-room-demo] server failed: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`[remote-room-demo] ${projectRoot}`);
  console.log(`[remote-room-demo] device: ${deviceName}`);
  console.log(`[remote-room-demo] http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
  console.log(`[remote-room-demo] http://127.0.0.1:${port}/group.html?token=${encodeURIComponent(token)}`);
  if (tokenSource === "generated") {
    console.log("[remote-room-demo] a new access token was generated and saved to runtime/access-token");
  }
  if (!loopbackOnly && token.length < minimumStrongTokenLength) {
    console.warn(`[remote-room-demo] WARNING: the access token is shorter than ${minimumStrongTokenLength} characters while the`
      + " service accepts connections from other devices. Anyone who guesses it can run Codex on this computer."
      + " Omit --token to use a generated one, or pass --host 127.0.0.1 to stay local.");
  }
});
