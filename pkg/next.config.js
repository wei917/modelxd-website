/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent Next.js from compiling Supabase Edge Function files (Deno runtime)
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/supabase/functions/**', '**/_shared/**'],
    }
    return config
  },
}

module.exports = nextConfig
