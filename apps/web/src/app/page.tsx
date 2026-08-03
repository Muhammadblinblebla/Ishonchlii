import Link from 'next/link';
import { uz } from '@escrowuz/shared';

const steps = [
  { n: 1, title: uz.landing.step1Title, text: uz.landing.step1Text },
  { n: 2, title: uz.landing.step2Title, text: uz.landing.step2Text },
  { n: 3, title: uz.landing.step3Title, text: uz.landing.step3Text },
];

export default function LandingPage() {
  return (
    <div className="space-y-20">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="pt-8 text-center sm:pt-16">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
          {uz.landing.heroTitle}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          {uz.landing.heroSubtitle}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">
            {uz.landing.ctaPrimary}
          </Link>
          <Link href="#qanday" className="btn-secondary px-6 py-3 text-base">
            {uz.landing.ctaSecondary}
          </Link>
        </div>
      </section>

      {/* ── Uch qadam ────────────────────────────────────────────────────── */}
      <section id="qanday" className="scroll-mt-20">
        <h2 className="text-center text-2xl font-semibold text-slate-900">
          {uz.landing.howItWorks}
        </h2>

        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {steps.map((step) => (
            <li key={step.n} className="card p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {step.n}
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Pul qayerda turadi ───────────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <div className="grid gap-8 p-8 sm:grid-cols-2 sm:p-10">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">{uz.landing.safetyTitle}</h2>
            <ul className="mt-6 space-y-4">
              {[uz.landing.safety1, uz.landing.safety2, uz.landing.safety3].map((text) => (
                <li key={text} className="flex gap-3 text-sm text-slate-700">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs text-emerald-700"
                    aria-hidden
                  >
                    ✓
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* Pulning yo'lini ko'rsatuvchi sxema */}
          <div className="rounded-xl bg-slate-50 p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Pul qayerda turadi
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm">
                <span className="text-slate-600">Xaridor</span>
                <span className="text-slate-400" aria-hidden>
                  →
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border-2 border-brand-200 bg-brand-50 px-4 py-3">
                <span className="font-medium text-brand-900">Platforma (muzlatilgan)</span>
                <span className="text-brand-400" aria-hidden>
                  ⏸
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm">
                <span className="text-slate-600">Sotuvchi</span>
                <span className="text-xs text-slate-400">tasdiqdan keyin</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Yakuniy chaqiruv ─────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-slate-900 px-8 py-12 text-center sm:px-12">
        <h2 className="text-2xl font-semibold text-white">Birinchi savdongizni bugun boshlang</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-slate-300">
          Ro&apos;yxatdan o&apos;tish bepul. Komissiya faqat savdo muvaffaqiyatli
          yakunlanganda olinadi.
        </p>
        <Link
          href="/register"
          className="btn mt-8 bg-white px-6 py-3 text-base text-slate-900 hover:bg-slate-100"
        >
          {uz.landing.ctaPrimary}
        </Link>
      </section>
    </div>
  );
}
