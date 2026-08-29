'use client'

// ════════════════════════════════════════════════════════════════════════
//  Chemistry Guide — the in-app version of the printed booklet
//  "How Our Chemistry Works". A plain-language reference to every product
//  class in the program: what it is, how it works, and why it's on the sheet.
//  Educational only — the label is the law.
// ════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react'
import { Search, X, AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import { CHEM_HUES, CHEM_JOBS, CHEM_SECTIONS, CHEM_ROTATION } from '@/lib/chemistry'

const FOREST = '#16291F'
const GOLD = '#C9A84C'

// soft tint of a hue for chips / accents
function tint(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function ProductCard({ card, hue }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex">
      <div className="w-1.5 shrink-0" style={{ backgroundColor: hue }} />
      <div className="p-4 min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <span className="font-display text-base font-semibold text-slate-900">{card.name}</span>
          <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap" style={{ backgroundColor: tint(hue, 0.12), color: hue }}>{card.chip}</span>
        </div>
        <p className="font-body text-[12px] text-slate-500 mb-0.5"><span className="font-mono text-[11px] text-slate-700">{card.ai}</span></p>
        <p className="font-body text-[10px] font-bold uppercase tracking-wide mb-2.5" style={{ color: hue }}>{card.group}</p>

        <div className="space-y-2">
          {card.how && (
            <div>
              <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">How it works</p>
              <p className="font-body text-[12.5px] leading-relaxed text-slate-700">{card.how}</p>
            </div>
          )}
          {card.why && (
            <div>
              <p className="font-body text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">Why we use it</p>
              <p className="font-body text-[12.5px] leading-relaxed text-slate-700">{card.why}</p>
            </div>
          )}
        </div>

        {card.note && (
          <div className="mt-2.5 rounded-xl px-3 py-2 flex gap-2 items-start" style={{ backgroundColor: card.verify ? '#FEF6E7' : card.risk === 'hi' ? '#FDECEA' : '#F4F6F5' }}>
            {card.verify
              ? <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: '#B9821A' }} />
              : card.risk === 'hi'
              ? <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: '#C0392B' }} />
              : <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />}
            <p className="font-body text-[11.5px] leading-snug" style={{ color: card.verify ? '#8A6212' : card.risk === 'hi' ? '#98271B' : '#556' }}>{card.note}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ChemistryGuide() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const term = q.trim().toLowerCase()

  const sections = useMemo(() => {
    return CHEM_SECTIONS
      .filter((s) => cat === 'all' || s.id === cat)
      .map((s) => {
        if (!term) return s
        const cards = s.cards.filter((c) =>
          `${c.name} ${c.chip} ${c.ai} ${c.group} ${c.how || ''} ${c.why || ''} ${c.note || ''}`.toLowerCase().includes(term))
        return { ...s, cards }
      })
      .filter((s) => s.cards.length > 0)
  }, [term, cat])

  return (
    <div className="max-w-5xl space-y-5 pb-8">
      {/* Header */}
      <div>
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Congressional Country Club · Grounds</p>
        <h2 className="font-display text-2xl font-semibold text-slate-900 mt-0.5">Chemistry Guide</h2>
        <p className="font-body text-[13px] text-slate-500 mt-1 max-w-2xl">How every product in the program actually works — on the plant or in the soil — and why it’s on the sheet. For the crew, the interns, and anyone who wants the <em>why</em> behind the tank.</p>
      </div>

      {/* The big idea */}
      <div className="rounded-2xl p-4 sm:p-5" style={{ backgroundColor: FOREST }}>
        <p className="font-display text-[15px] font-medium text-white/95 leading-snug mb-3.5">Every product in the tank is doing one of a few jobs. Once you know which job a product does, you know why it’s there — and what it can and can’t do.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {CHEM_JOBS.map((j) => (
            <div key={j.job} className="rounded-xl px-3 py-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderLeft: `3px solid ${CHEM_HUES[j.hue]}` }}>
              <p className="font-body text-[13px] font-bold text-white">{j.job}</p>
              <p className="font-body text-[11px] text-white/60 leading-snug mt-0.5">{j.blurb}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, active ingredients, FRAC/HRAC groups…" className="w-full border border-slate-200 rounded-xl pl-9 pr-9 py-2.5 text-sm font-body" />
        {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X size={15} /></button>}
      </div>

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mt-1">
        <button onClick={() => setCat('all')} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition" style={cat === 'all' ? { backgroundColor: FOREST, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>All</button>
        {CHEM_SECTIONS.map((s) => {
          const on = cat === s.id
          const hue = CHEM_HUES[s.hue]
          return (
            <button key={s.id} onClick={() => setCat(s.id)} className="font-body text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition inline-flex items-center gap-1.5" style={on ? { backgroundColor: hue, color: 'white' } : { backgroundColor: 'white', color: '#64748B', border: '1px solid rgba(0,0,0,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: on ? 'white' : hue }} />{s.title}
            </button>
          )
        })}
      </div>

      {/* Sections */}
      {sections.length === 0 && (
        <p className="font-body text-sm text-slate-400 py-8 text-center">No products match “{q}”.</p>
      )}
      {sections.map((s) => {
        const hue = CHEM_HUES[s.hue]
        return (
          <section key={s.id} className="space-y-3">
            <div className="flex items-center gap-2.5 pt-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hue }} />
              <h3 className="font-display text-lg font-semibold text-slate-900">{s.heading}</h3>
              <span className="font-body text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: hue }}>{s.tag}</span>
            </div>
            <p className="font-body text-[12.5px] leading-relaxed text-slate-500 max-w-3xl">{s.intro}</p>
            <div className="grid md:grid-cols-2 gap-3">
              {s.cards.map((c) => <ProductCard key={c.name} card={c} hue={hue} />)}
            </div>
          </section>
        )
      })}

      {/* Rotation primer */}
      {cat === 'all' && !term && (
        <section className="space-y-3 pt-2">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} style={{ color: GOLD }} />
            <h3 className="font-display text-lg font-semibold text-slate-900">{CHEM_ROTATION.heading}</h3>
          </div>
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 sm:p-5 space-y-3">
            <p className="font-display text-[15px] font-semibold text-slate-900">{CHEM_ROTATION.title}</p>
            {CHEM_ROTATION.body.map((p, i) => (
              <p key={i} className="font-body text-[12.5px] leading-relaxed text-slate-600">{p}</p>
            ))}
            <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
              <div className="rounded-xl p-3" style={{ backgroundColor: '#F1F7F2' }}>
                <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#2E7D46' }}>Low resistance risk — multi-site</p>
                <p className="font-body text-[12px] leading-snug text-slate-600">{CHEM_ROTATION.low}</p>
              </div>
              <div className="rounded-xl p-3" style={{ backgroundColor: '#FDECEA' }}>
                <p className="font-body text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#C0392B' }}>Higher resistance risk — single-site</p>
                <p className="font-body text-[12px] leading-snug text-slate-600">{CHEM_ROTATION.high}</p>
              </div>
            </div>
            <p className="font-body text-[12.5px] leading-relaxed text-slate-700 pt-1">{CHEM_ROTATION.golden}</p>
          </div>
        </section>
      )}

      {/* Footer disclaimer */}
      <div className="rounded-xl px-4 py-3" style={{ backgroundColor: '#F4F6F5', border: '1px solid rgba(0,0,0,0.05)' }}>
        <p className="font-body text-[11px] leading-relaxed text-slate-500">
          <span className="font-bold text-slate-600">About this guide.</span> An educational summary of the products on our spray sheets, compiled from the labels and standard turf references (FRAC/HRAC classifications, university extension). It explains how each chemistry works in plain terms — it is <b>not</b> a substitute for the label, a recommendation, or a rate guide. Anywhere it says “verify the label,” confirm the active ingredient before acting.
        </p>
      </div>
    </div>
  )
}
