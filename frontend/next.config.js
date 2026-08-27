/** @type {import('next').NextConfig} */
// Backend origin. Override with API_ORIGIN (Docker, tests, remote API).
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:3000';

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
  // Increase proxy timeout for long-running scans (5 minutes)
  experimental: {
    proxyTimeout: 300000,
  },
};

module.exports = nextConfig;
