import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Self-contained server bundle for `docker run` (see Dockerfile).
  output: "standalone",
  // Cloud previews are served from a per-VM hostname that changes on restore, so it is supplied
  // per process instead of being committed here.
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
};

export default nextConfig;
