/** @type {import('next').NextConfig} */
const nextConfig = {
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
