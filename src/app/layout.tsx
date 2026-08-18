import type { Metadata } from 'next';
import { RouteMotionShell } from '@/components/RouteMotionShell';
import './globals.css';
import './notion-redesign.css';

export const metadata: Metadata = {
  title: 'Arcane Codex',
  description: 'Local-first Notion-style workspace',
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
