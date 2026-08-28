import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Account creation and farming were merged into the pipeline. Anyone with
   * either page open or bookmarked lands on the screen that replaced it rather
   * than on a 404 — the addresses were in people's tabs, so removing them
   * without a forward is the same as breaking them.
   */
  async redirects() {
    return [
      { source: '/account-creation', destination: '/pipeline', permanent: false },
      { source: '/account-creation/:path*', destination: '/pipeline', permanent: false },
      { source: '/farming', destination: '/pipeline', permanent: false },
      { source: '/farming/:path*', destination: '/pipeline', permanent: false },
      // Parked sections are NOT redirected — they answer 404 on purpose, so a
      // bookmark to a screen being rebuilt says so instead of quietly landing
      // somewhere else. See `parked` in rbac.ts.
    ]
  },
}

export default nextConfig
