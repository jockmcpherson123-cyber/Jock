/** @type {import('next').NextConfig} */
const nextConfig = {
  // Make sure the private course-overlay asset is bundled into the serverless
  // function that serves it (it lives outside /public on purpose).
  outputFileTracingIncludes: {
    '/api/course-overlay': ['./assets/course/**'],
    '/api/course-pipes': ['./assets/course/**'],
    '/api/course-heads': ['./assets/course/**'],
  },
}

export default nextConfig
