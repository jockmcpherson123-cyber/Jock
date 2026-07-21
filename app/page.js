// The home page. This is a Server Component: it runs on the server, reads who
// is logged in (and their role) from the database, and renders accordingly.
//
// The proxy already guarantees nobody reaches this page without logging in,
// so `user` here is always present. For Phase 0 this is a simple confirmation
// screen; in Phase 1 it becomes the real Spray Ops dashboard.
import { getUser } from '@/lib/getUser'
import { logout } from '@/app/actions/auth'

const ROLE_LABELS = {
  operator: 'Operator',
  superintendent: 'Superintendent',
  director: 'Director of Grounds',
}

const ROLE_BLURB = {
  operator: 'You can view approved spray sheets once the module is live.',
  superintendent:
    'You will be able to create and edit sheets, and manage the chemical library, inventory and settings.',
  director:
    'You will be able to do everything a superintendent can, plus approve and reject sheets.',
}

export default async function HomePage() {
  const user = await getUser()
  const roleLabel = ROLE_LABELS[user.role] || 'Operator'

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--cream)' }}>
      {/* Dark green top bar — the layout pattern from the brief. */}
      <header style={{ backgroundColor: 'var(--forest)' }} className="text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div>
            <p
              className="font-display text-[10px] tracking-[0.25em] uppercase"
              style={{ color: 'var(--gold)' }}
            >
              Congressional Country Club
            </p>
            <h1 className="font-display text-2xl font-semibold mt-0.5">
              Grounds Operations
            </h1>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="font-body text-xs font-semibold px-3.5 py-2 rounded-full border border-white/20 text-white/80 hover:text-white transition"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-8 max-w-xl">
          <p
            className="font-body text-[11px] font-bold uppercase tracking-wide mb-2"
            style={{ color: 'var(--fern)' }}
          >
            Signed in
          </p>
          <h2 className="font-display text-2xl font-semibold text-slate-900">
            Welcome, {user.fullName}
          </h2>
          <p className="font-body text-sm text-slate-500 mt-1">{user.email}</p>

          <div
            className="mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1"
            style={{ backgroundColor: '#E8F3EC' }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: 'var(--fern)' }}
            />
            <span
              className="font-body text-xs font-bold"
              style={{ color: 'var(--fern)' }}
            >
              {roleLabel}
            </span>
          </div>

          <p className="font-body text-sm text-slate-600 mt-6 leading-relaxed">
            {ROLE_BLURB[user.role]}
          </p>

          <div className="mt-8 border-t border-black/5 pt-6">
            <p className="font-body text-xs text-slate-400 leading-relaxed">
              This is the foundation build (Phase 0): real logins and a real
              database are now working. The full Spray Ops dashboard, chemical
              library, inventory, reports and settings are being built on top of
              this next.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
