/**
 * Server-side ``rewrites`` make every ``/api/*`` request from the
 * frontend look like a same-origin call to the browser, even though
 * the actual backend lives on a different host (Railway). That fixes
 * the cross-site cookie problem: browsers in 2026 (Safari, Chrome
 * with 3PCD) block or partition cookies set by a third-party origin,
 * so a Vercel frontend + Railway backend setup loses the auth
 * session every time the tab is closed. With the rewrite, the
 * Set-Cookie header flows back through Vercel and gets stored
 * against the Vercel origin → first-party cookie, no blocking.
 *
 * Configure ``BACKEND_URL`` as a server-side env var in Vercel
 * (Settings → Environment Variables, NOT exposed to NEXT_PUBLIC_).
 * In local dev this is unset and the rewrite no-ops (requests fall
 * through to ``NEXT_PUBLIC_API_URL`` which defaults to localhost:8000).
 */
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (!BACKEND_URL) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
  images: {
    // Steam avatar CDNs — Steam Web API returns ``avatarfull`` URLs
    // pointing at ``avatars.steamstatic.com`` (and Cloudflare mirror).
    // ``media.steampowered.com`` is the legacy path some older
    // accounts still use. Without these, <Image src="..."/> would
    // refuse to render the Steam profile picture in the TopBar.
    domains: [
      "avatars.githubusercontent.com",
      "lh3.googleusercontent.com",
      "avatars.steamstatic.com",
      "avatars.akamai.steamstatic.com",
      "avatars.cloudflare.steamstatic.com",
      "steamcdn-a.akamaihd.net",
      "media.steampowered.com",
    ],
  },
  experimental: {
    typedRoutes: false,
  },
};

module.exports = nextConfig;
