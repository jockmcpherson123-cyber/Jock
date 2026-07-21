'use client'

// The login screen — the first thing anyone sees before they're allowed in.
// It's a Client Component because it uses React state to show error messages
// and a "signing in…" state while the server checks the password.
import { useActionState } from 'react'
import { login } from '@/app/actions/auth'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 font-body"
      style={{ backgroundColor: 'var(--forest)' }}
    >
      <div className="w-full max-w-sm">
        {/* Club identity */}
        <div className="text-center mb-8">
          <p
            className="font-display text-[11px] tracking-[0.28em] uppercase"
            style={{ color: 'var(--gold)' }}
          >
            Congressional Country Club
          </p>
          <h1 className="font-display text-3xl font-semibold text-white mt-1">
            Grounds Operations
          </h1>
        </div>

        {/* Login card */}
        <form
          action={formAction}
          className="bg-white rounded-2xl shadow-xl p-6 space-y-4"
        >
          <div>
            <label
              htmlFor="email"
              className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--fern)' }}
              placeholder="you@ccclub.org"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="font-body text-[11px] font-bold text-slate-400 uppercase tracking-wide block mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-body focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--fern)' }}
              placeholder="••••••••"
            />
          </div>

          {state?.error && (
            <p className="font-body text-sm text-red-600">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full font-body text-sm font-bold py-2.5 rounded-xl text-white transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--forest)' }}
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center font-body text-xs text-white/40 mt-6">
          Access is by invitation. Contact the Director of Grounds for an account.
        </p>
      </div>
    </main>
  )
}
