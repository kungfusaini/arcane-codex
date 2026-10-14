import type { Metadata } from 'next';
import { RouteMotionShell } from '@/components/RouteMotionShell';
import '@/styles/theme.css';
import '@/styles/base.css';
import '@/styles/workspace.css';
import '@/styles/collections.css';
import '@/styles/motion-responsive.css';
import '@/styles/notion-composition.css';

export const metadata: Metadata = {
  title: 'Arcane Codex',
  description: 'Local-first Notion-style workspace',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RouteMotionShell>{children}</RouteMotionShell>
      </body>
    </html>
  );
}
