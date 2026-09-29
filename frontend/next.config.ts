import type { NextConfig } from "next";

// The browser only ever talks to this Next.js server; API calls are proxied to FastAPI, so no backend
// URL, API key or LLM credential is ever shipped to the client.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // The Docker image sets NEXT_OUTPUT=standalone (self-contained `node server.js`); local builds are unchanged.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }];
  },
};

export default nextConfig;
