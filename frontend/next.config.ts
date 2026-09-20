import type { NextConfig } from 'next';

const config: NextConfig = {
  // The API runs on its own port in dev; this keeps the browser on one origin
  // so there are no CORS surprises and no hardcoded localhost in components.
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }];
  },
};

export default config;
