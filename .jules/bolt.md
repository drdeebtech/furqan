## 2025-05-22 - Replacing img tag with next/image
**Learning:** Found an opportunity to replace native img tags with Next.js Image components in public components to enable automatic image optimization (webp format, responsive sizing) and improve LCP metrics.
**Action:** Always prefer next/image over standard img tags for user-uploaded profile pictures and course covers in Next.js applications.
## 2025-05-22 - Replacing img with next/image remote patterns
**Learning:** Next.js `<Image>` strictly requires external image hostnames to be configured in `remotePatterns` within `next.config.js` (or `next.config.mjs`). Replacing native `<img>` tags with `<Image>` for user-provided avatars without ensuring their domains are configured will cause runtime crashes.
**Action:** When migrating from `<img>` to `<Image>`, always check if the `src` can originate from unconfigured remote domains. Revert to `<img>` for unknown remote sources or properly whitelist known domains like Supabase storage.
## 2025-05-22 - Replacing img with next/image
**Learning:** For user-provided URLs that might not come from the configured Supabase storage domain (e.g., Google OAuth profile pictures, Gravatar), using next/image without the unoptimized prop causes runtime crashes if the domain is not in next.config.ts remotePatterns.
**Action:** When migrating from img to next/image for dynamically sourced URLs (like avatar_url or cover_image_url), use unoptimized as a safety fallback since it maintains lazy-loading and layout shift benefits even without the image resizing.
