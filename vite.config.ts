import vinext from "vinext";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// VIGILKLINE deploys through Vercel using Nitro's Vercel adapter. The app and
// API route remain server-rendered, while OPENAI_API_KEY stays server-only.
export default defineConfig({
  server: {
    host: "0.0.0.0",
  },
  plugins: [vinext(), nitro({ serverDir: "server" })],
});
