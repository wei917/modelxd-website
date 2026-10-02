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
  // XCut renders and the platform video export run ffmpeg-static's binary:
  // keep the package out of the bundle and trace the binary into the
  // functions that spawn it.
  serverExternalPackages: ['ffmpeg-static'],
  // Metadata in <head>, before first paint, for every visitor. By default
  // Next 16 streams the <title> into <body> after the shell has hydrated,
  // which overwrote the tab title the XTell/XCreate top bars had just set
  // (they re-set it at 800 and 2500 ms to win). Every generateMetadata here
  // only reads request headers (the door and lib/lang.ts's language), so
  // waiting for it costs nothing.
  htmlLimitedBots: /.*/,
  outputFileTracingIncludes: {
    '/api/xcut/render': ['./node_modules/ffmpeg-static/ffmpeg', './public/fonts/**'],
    // Platform video export (Oct 1) re-encodes with the same binary.
    '/api/xcreate/export-video': ['./node_modules/ffmpeg-static/ffmpeg'],
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
