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
