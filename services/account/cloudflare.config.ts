import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "negus-account", entrypoint: "./worker.mjs", compatibilityDate: "2026-11-23",
    compatibilityFlags: ["nodejs_compat"], workersDev: false, domains: ["auth.negus.us.ci"],
    env: {
      DB: bindings.d1({name: "negus-account"}),
      AUTH_ORIGIN: bindings.text("https://auth.negus.us.ci"),
      MAIL_FROM: bindings.text("Negus <login@auth.negus.us.ci>"),
      BETTER_AUTH_SECRET: bindings.secret(), GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(), RESEND_API_KEY: bindings.secret()
    }
  }
});
