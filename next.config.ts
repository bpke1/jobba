import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // imapflow/mailparser pull in optional native-ish deps; keep them out of the bundle.
  serverExternalPackages: ["imapflow", "mailparser"],
};

export default nextConfig;
