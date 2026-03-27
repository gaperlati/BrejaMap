/** @type {import('next').NextConfig} */
const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: true,
  // Configure dev cross-origins (e.g. ngrok) via env:
  // NEXT_ALLOWED_DEV_ORIGINS="https://foo.ngrok-free.dev,https://bar.ngrok-free.dev"
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
