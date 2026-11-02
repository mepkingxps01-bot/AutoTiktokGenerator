import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM packages are loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["sharp", "harfbuzzjs"],
  // Fonts and the HarfBuzz WASM binary must ship with the serverless functions.
  outputFileTracingIncludes: {
    "/api/**/*": ["./assets/fonts/**/*", "./node_modules/harfbuzzjs/dist/*.wasm"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
