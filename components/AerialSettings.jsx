'use client'

// Settings → Course Aerial. Upload the club's aerial photo ONCE here; it's the
// single source used by the Course Map and the Irrigation Map. The newest (or
// the one set as default) is what every screen shows.
import { useEffect, useState } from 'react'
import { Upload, Star, Trash2 } from 'lucide-react'
import { FOREST, FERN, GOLD, HAIR, INK, INK_2, INK_3 } from '@/lib/theme'
import * as cmdb from '@/lib/coursemap/db'
import { AddPhoto } from '@/components/GreensMap'
import { formatDate } from '@/lib/format'

export default function AerialSettings() {
  const [ctx, setCtx] = useState(null)
  const [imagery, setImagery] = useState([])
  const [defaultId, setDefaultId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async () => {
    const c = await cmdb.fetchCourseContext()
    setCtx(c); setDefaultId(c.settings?.default_imagery_id || null)
    setImagery(await cmdb.fetchImagery(c.courses[0]?.id))
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  const makeDefault = async (id) => { await cmdb.setDefaultImagery(id); setDefaultId(id); setNotice('Updated the course aerial everywhere.') }
  const remove = async (img) => { if (!window.confirm('Delete this photo? Screens using it will fall back to the next one or the satellite map.')) return; await cmdb.deleteImagery(img); await load() }

  if (loading) return <p className="font-body text-xs text-slate-500">Loading…</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="font-body text-xs text-slate-500 max-w-md">Upload your course aerial here once. The Course Map and the Irrigation Map both use it, so it only has to be done in one place. Set a photo as the default to make it the one everyone sees.</p>
        <button onClick={() => setAddOpen((v) => !v)} className="font-body text-xs font-bold px-3.5 py-2 rounded-full text-white flex items-center gap-1.5 shrink-0" style={{ backgroundColor: FOREST }}><Upload size={14} /> Add photo</button>
      </div>

      {notice && <div className="rounded-xl p-3 mb-3 font-body text-[13px]" style={{ backgroundColor: '#EAF2EC', color: '#2F5A3D', border: '1px solid #D5E5DA' }}>{notice}</div>}

      {addOpen && ctx && (
        <AddPhoto courses={ctx.courses || []} clubId={ctx.club?.id} defaultCourseId={ctx.courses?.[0]?.id}
          onClose={() => setAddOpen(false)} onDone={(msg) => { setAddOpen(false); setNotice(msg); load() }} />
      )}

      {imagery.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: HAIR }}>
          <p className="font-body text-[13px]" style={{ color: INK_2 }}>No aerial yet. Tap “Add photo” to upload your Nearmap (or any georeferenced) image. Without one, maps use the free satellite basemap.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {imagery.map((img) => {
            const isDefault = img.id === defaultId
            return (
              <div key={img.id} className="flex items-center justify-between gap-3 rounded-2xl border p-3" style={{ borderColor: HAIR, backgroundColor: 'white' }}>
                <div>
                  <p className="font-body text-[13px] font-bold" style={{ color: INK }}>{img.capturedOn ? formatDate(img.capturedOn, 'header') : 'Aerial photo'} {isDefault && <span className="ml-1 font-body text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FBF4DF', color: '#886717' }}>Default</span>}</p>
                  <p className="font-body text-[11px]" style={{ color: INK_3 }}>{img.widthPx}×{img.heightPx}px · {img.source} · uploaded {formatDate(img.uploadedAt, 'list')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!isDefault && <button onClick={() => makeDefault(img.id)} className="font-body text-[12px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ border: `1px solid ${HAIR}`, color: FOREST }}><Star size={13} /> Set default</button>}
                  <button onClick={() => remove(img)} className="font-body text-[12px] font-bold px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1" style={{ color: '#B23A2E' }}><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
