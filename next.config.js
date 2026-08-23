const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack is the default bundler in Next 16. Pin the workspace root
  // explicitly to this folder — otherwise turbopack walks up the filesystem
  // looking for the highest package-lock.json and misidentifies an ancestor
  // directory (e.g. ~/Documents) as the project root when a stray lockfile
  // exists there. That misidentification breaks the React client manifest
  // (module paths get prefixed with the subpath from the fake root) and
  // shows up as "Could not find the module ... #default" errors.
  turbopack: {
    root: __dirname,
  },
  // XCut renders with ffmpeg-static's binary: keep the package out of the
  // bundle and trace the binary into the one function that spawns it.
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/xcut/render': ['./node_modules/ffmpeg-static/ffmpeg', './public/fonts/**'],
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/supabase/functions/**', '**/_shared/**'],
    }
    return config
  },
}

module.exports = nextConfig
