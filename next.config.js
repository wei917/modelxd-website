const path = require('path')
const { RENAMED_APPS } = require('./lib/renamed-apps')

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
  // XGame chess (Oct 19) runs ffish, Fairy-Stockfish's WebAssembly build
  // (GPL-3.0, server only): kept external so Node loads it from
  // node_modules, with its .wasm traced into the route (lib/chess-engine.ts).
  serverExternalPackages: ['ffmpeg-static', 'ffish'],
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
    // 晴晴's fresh clips for admins (Oct 16) are re-encoded small.
    '/api/xsports/cheer': ['./node_modules/ffmpeg-static/ffmpeg'],
    // 同款 cuts a picture of each material from the video it reads (Oct 13).
    '/api/xcreate/remake/breakdown': ['./node_modules/ffmpeg-static/ffmpeg'],
    // ...and its make job cuts, captions and mixes the remake (Oct 17). A
    // glob, because a dynamic segment's [id] reads as a character class.
    // fonts/ is the burned-in text's (lib/caption-text.ts), not XCut's.
    '/api/xcreate/remake/*/make': ['./node_modules/ffmpeg-static/ffmpeg', './fonts/**'],
    // The 風扇變裝 template's runs draw the fan and lay the sound (Oct 18; no
    // captions, so no fonts).
    '/api/xcreate/remake/fan': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/xcreate/remake/fan/*': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/xgame/chess': ['./node_modules/ffish/ffish.js', './node_modules/ffish/ffish.wasm'],
    '/api/xgame/xiangqi': ['./node_modules/ffish/ffish.js', './node_modules/ffish/ffish.wasm'],
  },
  // Old app addresses forward to the new ones, path and query kept
  // (lib/renamed-apps.js: /xdev → /xkit, …).
  async redirects() {
    return RENAMED_APPS.flatMap(r => [
      { source: r.from, destination: r.to, permanent: r.permanent },
      ...(r.subpaths ? [{ source: `${r.from}/:path*`, destination: `${r.to}/:path*`, permanent: r.permanent }] : []),
    ])
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
