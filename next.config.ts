import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev database) loads its .wasm/.data files from its own folder; bundling breaks those paths
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
