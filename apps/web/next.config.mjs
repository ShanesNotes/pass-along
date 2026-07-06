/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve.extensionAlias = {
        ...config.resolve.extensionAlias,
        // Workspace packages use NodeNext TS, so their internal imports keep
        // runtime .js specifiers even while Next bundles the .ts sources.
        ".js": [".ts", ".js"]
      };
    }

    return config;
  }
};

export default nextConfig;
