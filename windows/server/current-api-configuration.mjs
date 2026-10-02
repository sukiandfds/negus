import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import TOML from "@iarna/toml";

// Bind to the native runtime's configuration, not CC Switch's current flag.
export const readCurrentApiConfiguration = async (home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")) => {
  const text = await fs.readFile(path.join(home, "config.toml"), "utf8").catch(e => { if (e.code === "ENOENT") return ""; throw e; });
  const config = TOML.parse(text);
  const provider = config.model_providers?.[config.model_provider];
  if (!provider?.base_url || provider.auth) return null;
  const auth = await fs.readFile(path.join(home, "auth.json"), "utf8").then(JSON.parse).catch(e => { if (e.code === "ENOENT") return {}; throw e; });
  const key = provider.experimental_bearer_token || (provider.env_key ? process.env[provider.env_key] : auth.OPENAI_API_KEY);
  if (!key) return null;
  const url = new URL(provider.base_url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return { model: typeof config.model === "string" ? config.model : "", baseUrl: url.href.replace(/\/$/u, ""), key, name: provider.name || config.model_provider };
};
