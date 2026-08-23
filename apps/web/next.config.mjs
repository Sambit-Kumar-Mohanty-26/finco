import path from "node:path";

const nextConfig = {
  reactStrictMode: true,
  // @finco/core ships TypeScript source, so Next compiles it with the app
  transpilePackages: ["@finco/core"],
  // An unrelated package-lock.json sits above this repo; pin the root explicitly.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
};

export default nextConfig;
