// Keep the compatibility switch in one tiny entry point.  The explicit export
// makes this file a TypeScript module so it can use a top-level async loader.
export {};

const legacy = new URLSearchParams(window.location.search).get('legacy') === '1';
if (legacy) {
  // The legacy client is intentionally JavaScript and has no declaration file.
  // @ts-ignore -- compatibility entry, checked by the legacy runtime itself.
  await import('./app.js');
} else {
  await import('./play');
}
