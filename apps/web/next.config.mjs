/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: shared paketi TypeScript manbadan keladi
  transpilePackages: ['@escrowuz/shared'],
};

export default nextConfig;
