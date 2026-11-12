import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // CSV 가져오기는 파일 자체를 1MB까지 받는다. multipart 머리말이 붙으므로 여유를 둔다.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
