import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  // Die Einwilligung für den MCP-Zugang darf nicht in fremde Seiten eingebettet werden (Clickjacking)
  async headers() {
    return [{
      source: '/oauth/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      ],
    }]
  },
}

initOpenNextCloudflareForDev()

export default nextConfig
