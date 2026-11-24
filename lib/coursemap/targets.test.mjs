import { resolveTarget, withException, coverageIssues, dateInSeason } from './targets.js'
let p=0,f=0; const ok=(c,m)=>{c?p++:(f++,console.error('✗ '+m))}
const targets=[
 {id:'win',name:'Winter',surface:'green',startMd:'11-01',endMd:'03-31',vwcLo:18,vwcHi:26},
 {id:'sum',name:'Summer',surface:'green',startMd:'04-01',endMd:'10-31',vwcLo:20,vwcHi:30,aim:24},
]
ok(dateInSeason('2026-01-15','11-01','03-31'),'wrap Jan in winter')
ok(!dateInSeason('2026-07-15','11-01','03-31'),'Jul not winter')
const w=resolveTarget(targets,'2026-12-20'); ok(w.id==='win'&&w.aim===22,'winter target + default aim 22')
const s=resolveTarget(targets,'2026-07-15'); ok(s.id==='sum'&&s.aim===24,'summer target aim 24')
const ex=[{areaId:'g1',targetId:null,vwcLo:22,vwcHi:28,aim:25}]
const wx=withException(s,ex,'g1'); ok(wx.lo===22&&wx.hi===28&&wx.aim===25&&wx.exception,'exception overrides for g1')
ok(withException(s,ex,'g2').lo===20,'no exception for g2')
ok(coverageIssues(targets).length===0,'full-year coverage ok')
ok(coverageIssues([{surface:'green',startMd:'04-01',endMd:'09-30',vwcLo:20,vwcHi:30}]).length>0,'gap flagged')
console.log(`${p} passed, ${f} failed`); process.exit(f?1:0)
