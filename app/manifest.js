// Web app manifest — makes the app installable to a home screen and run
// standalone (its own window, no browser chrome), so the crew can open it like
// a native app on an iPad or phone in the field.
export default function manifest() {
  return {
    name: 'Grounds Operations',
    short_name: 'Grounds',
    description: 'Spray sheets, chemical library, agronomy and compliance for golf course grounds.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#16291F',
    theme_color: '#16291F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
