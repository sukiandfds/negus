import {defineConfig} from "vite";
import {cloudflare} from "@cloudflare/vite-plugin";
export default defineConfig({publicDir:false,plugins:[cloudflare()]});
