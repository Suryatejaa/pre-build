import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Property Record', template: '%s · Property Record' }, description: 'A considered foundation for your home and its history.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-IN"><body><a href="#main" className="skip-link">Skip to content</a>{children}</body></html>;
}
