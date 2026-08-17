/** @type {import('next').NextConfig} */
const nextConfig = {
  // The canonical public site URL, baked in at build time. QR codes (parts,
  // inventory, crew board, mowing routes) use this so they always point at the
  // real production domain — never the one-off preview URL a manager happened to
  // be viewing when they generated the code (which is login-protected). On Vercel
  // this resolves to the production domain / custom domain automatically.
  env: {
    NEXT_PUBLIC_SITE_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '',
  },
  // Make sure the private course-overlay asset is bundled into the serverless
  // function that serves it (it lives outside /public on purpose).
  outputFileTracingIncludes: {
    '/api/course-overlay': ['./assets/course/**'],
    '/api/course-pipes': ['./assets/course/**'],
    '/api/course-wires': ['./assets/course/**'],
    '/api/course-heads': ['./assets/course/**'],
  },
}

export default nextConfig
