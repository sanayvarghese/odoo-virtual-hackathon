import type { NextConfig } from "next";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    // NB: only the AI chat SSE endpoint is proxied so the EventSource path
    // stays same-origin; everything else uses the API origin directly.
    return [{ source: "/api/ai/chat", destination: `${API_ORIGIN}/api/v1/ai/chat` }];
  },
};

export default nextConfig;
