import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arcane Codex',
  description: 'Local-first Notion-style workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
