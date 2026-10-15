/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.ARCANE_NEXT_DIST_DIR || '.next',
  experimental: {
    typedRoutes: false,
  },
};

module.exports = nextConfig;
