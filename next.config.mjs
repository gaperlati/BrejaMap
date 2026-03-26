/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Avoid Next.js dev warning/error when accessing from ngrok (different origin).
  allowedDevOrigins: ["https://ingenuous-coexistent-cris.ngrok-free.dev"],
};

export default nextConfig;
