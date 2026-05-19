import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer ships native-ish deps (yoga-layout wasm, fontkit).
  // If Next bundles it the PDF route 500s at runtime on Vercel even though
  // the build passes — keep it external so it loads from node_modules.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
