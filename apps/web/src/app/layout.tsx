import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/AuthProvider';
import { Header } from '@/components/Header';
import './globals.css';

export const metadata: Metadata = {
  title: 'Escrow.uz — Xavfsiz savdo platformasi',
  description:
    'Pul platformada muzlatib turiladi va faqat siz tovarni olganingizni tasdiqlaganingizdan keyin sotuvchiga o\'tadi.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a5cf5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body className="min-h-screen">
        <AuthProvider>
          <Header />
          <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">{children}</main>
          <footer className="mt-16 border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-5xl px-4 py-8 text-center text-sm text-slate-500 sm:px-6">
              Escrow.uz — pul faqat tovar yetib borgach o&apos;tadi
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
