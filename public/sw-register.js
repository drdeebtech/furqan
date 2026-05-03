// Service worker registration. Lives in its own file (rather than inline in
// layout.tsx) so the CSP `script-src` directive can drop `'unsafe-inline'`.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
