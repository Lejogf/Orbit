import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible, Inter, JetBrains_Mono, Lexend, Plus_Jakarta_Sans } from 'next/font/google';
import { AccessibilityProvider } from '@/lib/accessibility';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap', preload: false });
// Only fetched when someone turns the matching accessibility setting on.
const readable = Atkinson_Hyperlegible({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-readable', display: 'swap', preload: false });
const lexend = Lexend({ subsets: ['latin'], variable: '--font-lexend', display: 'swap', preload: false });

export const metadata: Metadata = {
  title: 'Orbit — money that moves with you',
  description: 'Banking that shows you the money you have already committed, and helps you keep more of it.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Orbit', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6f4' },
    { media: '(prefers-color-scheme: dark)', color: '#080d0a' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Never block pinch-zoom: people with low vision rely on it.
  maximumScale: 5,
};

/**
 * Applies the saved theme before first paint, so a dark-mode customer never
 * sees a white flash on load.
 */
const THEME_BOOTSTRAP = `(function(){try{var s=JSON.parse(localStorage.getItem('flow.a11y.v1')||'{}');var t=s.theme||'system';var dark=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=dark?'dark':'light';if(s.textScale)r.style.fontSize=(s.textScale*100)+'%';if(s.contrast)r.dataset.contrast=s.contrast;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${display.variable} ${mono.variable} ${readable.variable} ${lexend.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="font-sans">
        <AccessibilityProvider>{children}</AccessibilityProvider>
      </body>
    </html>
  );
}
