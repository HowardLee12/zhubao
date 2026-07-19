import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer ships native-ish deps (yoga-layout wasm, fontkit).
  // If Next bundles it the PDF route 500s at runtime on Vercel even though
  // the build passes — keep it external so it loads from node_modules.
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    const publicCapabilityHeaders = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Cache-Control", value: "private, no-store" },
    ];

    return [
      {
        source: "/public/quotes",
        headers: publicCapabilityHeaders,
      },
      {
        source: "/public/quotes/:path*",
        headers: publicCapabilityHeaders,
      },
      {
        source: "/api/v2/public/quotes/:path*",
        headers: publicCapabilityHeaders,
      },
    ];
  },
};

export default nextConfig;
