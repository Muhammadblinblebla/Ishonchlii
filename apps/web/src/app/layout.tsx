import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/AuthProvider';
import { Header } from '@/components/Header';
import './globals.css';

export const metadata: Metadata = {
  title: 'ishonchli.uz — Xavfsiz savdo platformasi',
  description:
    'Pul platformada muzlatib turiladi va faqat siz olganingizni tasdiqlaganingizdan keyin ' +
    'sotuvchiga o\'tadi. Jismoniy tovar ham, o\'yin akkaunti ham.',
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
          <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
          <footer className="mt-16 border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-5xl px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-slate-500 sm:px-6">
              ishonchli.uz — pul faqat siz tasdiqlaganingizdan keyin o&apos;tadi
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
