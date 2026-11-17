import { createCcSwitchConfigService } from "../server/cc-switch-config-service.mjs";
// Invoked only by Codex command authentication; stdout is its secret transport.
// Never include credentials in arguments, generated TOML or error output.
try {
  const [database, providerId] = process.argv.slice(2);
  if (!database || !providerId) throw Error("invalid arguments");
  const service = createCcSwitchConfigService({ database });
  process.stdout.write(await service.readCredential(providerId));
} catch {
  process.stderr.write("无法读取共享配置凭据，请检查配置是否变更。\n");
  process.exitCode = 1;
}
