/** @type {import('next').NextConfig} */
const e2eDistDir = process.env.E2E_NEXT_DIST_DIR

const nextConfig = {
  // Keep Playwright's development build artifacts separate from a local `next dev`.
  ...(e2eDistDir
    ? {
        distDir: e2eDistDir,
        typescript: { tsconfigPath: 'e2e/tsconfig.next-e2e.json' },
      }
    : {}),
  allowedDevOrigins: ['127.0.0.1'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
