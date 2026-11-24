/**
 * Set when the app is built for static hosting (S3 + CloudFront, scripts/deploy-static.sh).
 * There is no Stacks server then, so link previews are skipped.
 */
export const STATIC_HOSTING = import.meta.env.VITE_STATIC_HOSTING === '1';
