import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { createClient } from '@supabase/supabase-js';

const LS = { url:'gl_sb_url', key:'gl_sb_key' };

// ---------- 직원 권한 ----------
// 프리랜서(trainer) 기능 접근을 마스터가 '권한' 탭에서 개별 제어. master는 전부 허용.
const PERM_KEYS = ['members','delete_members','calendar','lockers','sales','products','logs','refund'];
const PERM_LABELS = {
  members:'회원 조회·수정', delete_members:'회원·회원권 삭제', calendar:'캘린더·수업 관리',
  lockers:'락커', sales:'매출 보기', products:'상품 관리', logs:'로그·백업/복원', refund:'환불·미수금 수납',
};
const DEFAULT_TRAINER_PERMS = { members:true, calendar:true, lockers:true, delete_members:false, sales:false, products:false, logs:false, refund:false };
const OWNER_EMAILS = ['alsrl229@gmail.com']; // 안전망: staff 행이 없거나 테이블 문제여도 항상 마스터
const PermCtx = React.createContext({ role:'master', perms:{}, can:()=>true, email:'', name:'' });
function usePerm(){ return useContext(PermCtx); }

// ---------- 자동 로그인 ----------
// 체크하면 로그인 정보를 localStorage에 둔다 → 브라우저를 껐다 켜도 로그인 상태가 남는다.
// 해제하면 sessionStorage로 → 그 탭/브라우저를 닫으면 로그아웃된다(공용 PC용).
// ★기본값은 '켬'. 현장에서 폰으로 쓰는 게 주 용도라 매번 로그인하는 게 더 불편하다.
const AUTO_KEY='gl_autologin';
function autoLoginOn(){ try{ return localStorage.getItem(AUTO_KEY)!=='0'; }catch(e){ return true; } }
function setAutoLogin(on){ try{ localStorage.setItem(AUTO_KEY, on?'1':'0'); }catch(e){} }
// 저장 위치를 매 호출마다 판단한다 — 클라이언트는 로그인 화면보다 먼저 만들어지기 때문.
const authStorage={
  getItem(k){ try{ const v=localStorage.getItem(k); return v!==null? v : sessionStorage.getItem(k); }catch(e){ return null; } },
  setItem(k,v){ try{
    if(autoLoginOn()){ localStorage.setItem(k,v); sessionStorage.removeItem(k); }
    else { sessionStorage.setItem(k,v); localStorage.removeItem(k); }
  }catch(e){} },
  removeItem(k){ try{ localStorage.removeItem(k); sessionStorage.removeItem(k); }catch(e){} },
};

function getClient(){
  const url = localStorage.getItem(LS.url), key = localStorage.getItem(LS.key);
  if(!url || !key || !/^https?:\/\//i.test(url)) return null;
  try { return createClient(url, key, {auth:{storage:authStorage, persistSession:true, autoRefreshToken:true}}); }
  catch(e){ console.error('Supabase 연결 실패:', e); localStorage.removeItem(LS.url); localStorage.removeItem(LS.key); return null; }
}

// ---------- helpers ----------
function pad(n){ return String(n).padStart(2,'0'); }
// 금액 입력용: 숫자만 남기고 1,100,000 형식으로
function fmtNum(v){ const d=String(v??'').replace(/\D/g,''); return d? parseInt(d).toLocaleString():''; }
// 전화번호 입력 정규화: 010-1234-5678 형태로 자동 하이픈
function fmtPhone(v){ let d=String(v??'').replace(/\D/g,'').slice(0,11);
  if(d.length<4) return d;
  if(d.length<8){ if(d.startsWith('02')) return d.slice(0,2)+'-'+d.slice(2); return d.slice(0,3)+'-'+d.slice(3); }
  if(d.length===10) return d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
  return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7); }
// 전화 뒷자리(비교용): 숫자만
function phoneDigits(v){ return String(v??'').replace(/\D/g,''); }
function ymd(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtDate(s){ if(!s) return '-'; const d=new Date(s); return isNaN(d)?'-':`${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`; }
function fmtDT(s){ if(!s) return '-'; const d=new Date(s); if(isNaN(d))return '-'; return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function hm(s){ const d=new Date(s); return isNaN(d)?'':`${pad(d.getHours())}:${pad(d.getMinutes())}`; }
// 수업 시간 범위: 10:00~10:50 (end_at 없으면 시작시간만)
function hmRange(l){ const s=hm(l.start_at), e=l.end_at?hm(l.end_at):''; return e&&e!==s? s+'~'+e : s; }
function age(birth){ if(!birth) return ''; const b=new Date(birth); if(isNaN(b)) return ''; const d=new Date(); let a=d.getFullYear()-b.getFullYear(); const m=d.getMonth()-b.getMonth(); if(m<0||(m===0&&d.getDate()<b.getDate())) a--; return a>=0&&a<120? a+'세':''; }
function useEsc(onClose){ useEffect(()=>{ const h=e=>{ if(e.key==='Escape') onClose(); }; window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h); },[onClose]); }
// 강사별 색상 (캘린더) — 배경 밝기에 따라 글자색 자동 대비
const TRAINER_PALETTE=['#c0392b','#2e6da4','#2e8b57','#8156a7','#c9772d','#1f8a8a','#b5417a','#7d6b3a','#3f5c74','#5f8a2a','#b03a5b','#417a5a'];
function trainerFg(hex){ const h=hex.replace('#',''); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return (0.299*r+0.587*g+0.114*b)>150?'#0E1714':'#ffffff'; }
// CSV 다운로드 (엑셀 한글 안 깨지게 UTF-8 BOM)
function downloadCSV(filename,rows){
  const csv=rows.map(r=>r.map(c=>{const s=String(c==null?'':c);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
// 활동 로그 기록 (fire-and-forget: 실패해도 본 작업엔 영향 없음)
async function logAct(sb,action,detail){
  try{
    const {data}=await sb.auth.getUser();
    const email=(data&&data.user&&data.user.email)||'';
    await sb.from('logs').insert({actor:email,action,detail:detail||null});
  }catch(e){}
}

// ---------- 전체 조회 (1000행 상한 회피) ----------
// Supabase/PostgREST는 select에 범위를 안 주면 1000행에서 "조용히" 잘린다(에러도 경고도 없음).
// 회원·회원권·결제가 1000건을 넘는 순간 매출·리포트가 틀린 값으로 계산되므로,
// 전체를 훑는 조회는 반드시 이 함수를 통해 끝까지 가져온다.
//   make: 매번 새 쿼리를 만들어 주는 함수 — ()=>sb.from('payments').select('*').order('id')
//   정렬이 유일하지 않으면 페이지 경계에서 행이 중복·누락될 수 있어 id 보조정렬을 함께 건다.
async function fetchAll(make){
  let all=[], from=0;
  while(true){
    const {data,error}=await make().range(from,from+999);
    if(error) return {data:null,error};
    all=all.concat(data||[]);
    if(!data||data.length<1000) break;
    from+=1000;
  }
  return {data:all,error:null};
}

// ---------- 자동 백업(스냅샷) ----------
const SNAP_TABLES=['members','memberships','lessons','payments','lockers','products','trainer_colors','logs','member_notes','tasks','trainer_rates'];
const SNAP_OPTIONAL=new Set(['member_notes','tasks','trainer_rates']); // 부가 테이블: SQL 미실행/권한 없음이어도 백업은 계속
async function dumpAllTables(sb){
  const out={};
  for(const t of SNAP_TABLES){
    let all=[],from=0; const oc=(t==='trainer_colors'||t==='trainer_rates')?'name':'id';
    let failed=false;
    while(true){ const {data,error}=await sb.from(t).select('*').order(oc,{ascending:true}).range(from,from+999);
      if(error){ if(SNAP_OPTIONAL.has(t)){ failed=true; break; } throw new Error(t+': '+error.message); }
      all=all.concat(data||[]); if(!data||data.length<1000) break; from+=1000; }
    if(!failed) out[t]=all;
  }
  return out;
}
// 스냅샷 1장 저장 + 30일 지난 것 정리. 실패해도 본 작업엔 영향 없음.
async function snapshotNow(sb,label){
  try{
    const tables=await dumpAllTables(sb);
    const size_kb=Math.round(JSON.stringify(tables).length/1024);
    const {error}=await sb.from('crm_snapshots').insert({label,size_kb,tables});
    if(error) throw error;
    const cut=new Date(Date.now()-30*86400000).toISOString();
    await sb.from('crm_snapshots').delete().lt('taken_at',cut);
    return true;
  }catch(e){ console.warn('snapshot 실패:',e.message||e); return false; }
}
// 하루 1회만: 그날 첫 접속 시 자동 백업
async function maybeDailySnapshot(sb){
  const key='gymlord_crm_snap_daily_'+ymd(new Date());
  if(localStorage.getItem(key)) return;
  localStorage.setItem(key,'1'); // 중복 방지 먼저 (여러 탭)
  const ok=await snapshotNow(sb,'자동 일일');
  if(!ok) localStorage.removeItem(key);
}
// 삭제 직전: 그날 첫 삭제 전 상태 1장 보존 (실수 삭제 복구용)
async function maybeBeforeDeleteSnapshot(sb){
  const key='gymlord_crm_snap_del_'+ymd(new Date());
  if(localStorage.getItem(key)) return;
  localStorage.setItem(key,'1');
  const ok=await snapshotNow(sb,'삭제 전');
  if(!ok) localStorage.removeItem(key);
}

// 오프사이트 백업(파일 다운로드) 리마인더 — 마지막 다운로드 시각 로컬 기록
const LAST_BACKUP_KEY='gymlord_crm_last_backup';
function markBackup(){ try{ localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); }catch(e){} }
function daysSinceBackup(){ const v=Number(localStorage.getItem(LAST_BACKUP_KEY)||0); if(!v) return null; return Math.floor((Date.now()-v)/86400000); }
// 마지막 파일 백업 시각 = localStorage(이 브라우저) 와 서버 로그(모든 기기) 중 최신 것.
// localStorage만 보면 캐시를 지우거나 다른 PC·폰에서 열었을 때 실제로는 백업했는데도
// "백업한 적 없음"으로 잘못 뜬다. 반대로 서버 로그만 보면 오프라인 다운로드를 놓친다.
function useDaysSinceBackup(sb){
  const [days,setDays]=useState(()=>daysSinceBackup());
  useEffect(()=>{
    if(!sb) return; let alive=true;
    (async()=>{
      try{
        const {data}=await sb.from('logs').select('at')
          .in('action',['전체 백업','백업 내려받기'])
          .order('at',{ascending:false}).limit(1);
        if(!alive || !data || !data[0]) return;
        const newest=Math.max(new Date(data[0].at).getTime()||0, Number(localStorage.getItem(LAST_BACKUP_KEY)||0));
        if(newest) setDays(Math.floor((Date.now()-newest)/86400000));
      }catch(e){}
    })();
    return ()=>{ alive=false; };
  },[sb]);
  return days;
}

// ★lessons는 계속 쌓인다(2026-08 기준 493건, 월 ~250건). limit(5000)에 정렬이 없으면
//   1~2년 뒤 잘린 5000건이 '아무거나'가 되어 강사가 목록에서 사라질 수 있다.
//   최신순으로 읽으면 최근 활동한 강사는 항상 포함된다.
async function loadActiveTrainerNames(sb){
  const [ms,ls,tc]=await Promise.all([
    sb.from('memberships').select('trainer').eq('status','활성').not('trainer','is',null).limit(5000),
    sb.from('lessons').select('trainer').not('trainer','is',null).order('start_at',{ascending:false}).limit(5000),
    sb.from('trainer_colors').select('name').limit(5000)
  ]);
  const names=new Set();
  (ms.data||[]).forEach(r=>{ if(String(r.trainer||'').trim()) names.add(String(r.trainer).trim()); });
  (ls.data||[]).forEach(r=>{ if(String(r.trainer||'').trim()) names.add(String(r.trainer).trim()); });
  (tc.data||[]).forEach(r=>{ if(String(r.name||'').trim()) names.add(String(r.name).trim()); });
  return [...names].sort((a,b)=>a.localeCompare(b,'ko'));
}

function TrainerSelect({value,onChange,trainers,label='담당 강사'}){
  return (
    <div className="field"><label>{label}</label>
      <select value={value||''} onChange={e=>onChange(e.target.value)}>
        <option value="">담당 없음</option>
        {trainers.map(t=><option key={t} value={t}>{t}</option>)}
      </select>
      {trainers.length===0 && <div className="muted" style={{fontSize:12,marginTop:5}}>캘린더나 활성 회원권에 등록된 강사명이 아직 없습니다.</div>}
    </div>
  );
}

// GL 모노그램 (프리미엄 화면·아이콘용) — 이중 원 프레임 + GL 리가처
function GLMonogram({size=120, stroke=1.4, opacity=1, color='var(--brass)'}){
  const s={width:size, height:size, display:'block', opacity};
  return (<svg viewBox="0 0 120 120" style={s}>
    <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="60" cy="60" r="54"/>
      <circle cx="60" cy="60" r="49" opacity=".55"/>
      {/* G — 오픈 커브 + 인디케이터 */}
      <path d="M55 41c-9 0-15 8-15 19s6 19 15 19c8 0 14-6 14-14v-4H56"/>
      {/* L — 세리프 라인 */}
      <path d="M67 41v38h14"/>
      <path d="M63 41h8M77 79h8" opacity=".5"/>
    </g>
  </svg>);
}
// 이중 브라스 오너먼트 라인 (섹션 디바이더)
function Ornament({width=120}){
  return (<svg viewBox="0 0 120 8" style={{width,height:8,display:'block',margin:'0 auto'}}>
    <g stroke="var(--brass)" strokeWidth="1" fill="none">
      <line x1="4" y1="3" x2="52" y2="3"/>
      <line x1="4" y1="5" x2="52" y2="5" opacity=".5"/>
      <line x1="68" y1="3" x2="116" y2="3"/>
      <line x1="68" y1="5" x2="116" y2="5" opacity=".5"/>
      <circle cx="60" cy="4" r="1.6" fill="var(--brass)" stroke="none"/>
    </g>
  </svg>);
}

// ---------- 설정 ----------
function Setup({onDone}){
  const [url,setUrl]=useState(localStorage.getItem(LS.url)||'');
  const [key,setKey]=useState(localStorage.getItem(LS.key)||'');
  const [err,setErr]=useState('');
  function save(){
    const u=url.trim(), k=key.trim();
    if(!/^https?:\/\//i.test(u) || !/supabase\.(co|in)/i.test(u)){ setErr('① URL 칸에는 https://...supabase.co 주소를 넣어주세요. (키가 아니라 주소!)'); return; }
    if(!k){ setErr('② 키 칸을 채워주세요.'); return; }
    localStorage.setItem(LS.url,u); localStorage.setItem(LS.key,k); onDone();
  }
  return (
    <div className="center gl-scene"><GLMonogram size={520} opacity={.05} color="#B08D57" /><div className="panel gl-panel">
      <div className="gl-crest"><GLMonogram size={54} stroke={1.2} opacity={.9}/></div>
      <div className="logo gl-logo-center">GYMLORD<small>MEMBER OS · 연결설정</small></div>
      <Ornament/>
      <label>① Project URL <span className="muted">(주소)</span></label>
      <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://xxxx.supabase.co"/>
      <label>② API Key <span className="muted">(anon 또는 sb_publishable_...)</span></label>
      <input value={key} onChange={e=>setKey(e.target.value)} placeholder="sb_publishable_... 또는 eyJhbGci..."/>
      <button className="btn" onClick={save}>저장하고 연결</button>
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 로그인 ----------
function Login({sb,onIn}){
  const [email,setEmail]=useState(''),[pw,setPw]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const [keep,setKeep]=useState(autoLoginOn);
  async function go(){
    setBusy(true); setErr('');
    setAutoLogin(keep);   // ★로그인 **전에** 정해야 세션이 원하는 곳(local/session)에 저장된다
    const {error}=await sb.auth.signInWithPassword({email:email.trim(),password:pw});
    setBusy(false);
    if(error) setErr('로그인 실패: '+error.message); else onIn();
  }
  return (
    <div className="center gl-scene"><GLMonogram size={520} opacity={.05} color="#B08D57" /><div className="panel gl-panel">
      <div className="gl-crest"><GLMonogram size={54} stroke={1.2} opacity={.9}/></div>
      <div className="logo gl-logo-center">GYMLORD<small>MEMBER OS · 직원 로그인</small></div>
      <Ornament/>
      <label>이메일</label>
      <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} />
      <label>비밀번호</label>
      <input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} />
      <label className="chk">
        <input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)}/> 자동 로그인
      </label>
      <div className="muted" style={{fontSize:11,margin:'0 0 10px',lineHeight:1.5}}>
        {keep? '이 기기에 로그인 상태가 유지됩니다. 공용 PC에서는 꺼주세요.'
             : '브라우저를 닫으면 로그아웃됩니다.'}
      </div>
      <button className="btn" disabled={busy} onClick={go}>{busy?'확인 중...':'로그인'}</button>
      <div className="err">{err}</div>
      <button className="link" onClick={()=>{localStorage.removeItem(LS.url);localStorage.removeItem(LS.key);location.reload();}}>연결설정 다시하기</button>
    </div></div>
  );
}

// ---------- 레슨/회원권 등록 ----------
function RegisterModal({sb,member,onClose,onSaved}){
  useEsc(onClose);
  const [products,setProducts]=useState([]);
  const [trainers,setTrainers]=useState([]);
  const [payMethod,setPayMethod]=useState('카드');
  const t=new Date(); const plus=m=>{const d=new Date(t);d.setMonth(d.getMonth()+m);return d;};
  const [name,setName]=useState(''),[cat,setCat]=useState('PT'),[cnt,setCnt]=useState('10'),[price,setPrice]=useState('');
  const [received,setReceived]=useState('');
  const [sd,setSd]=useState(ymd(t)),[ed,setEd]=useState(ymd(plus(3))),[trainer,setTrainer]=useState('');
  const [err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const [selProd,setSelProd]=useState(null);
  useEffect(()=>{ sb.from('products').select('*').eq('active',true).order('sort').then(({data})=>setProducts(data||[])); },[]);
  useEffect(()=>{ loadActiveTrainerNames(sb).then(setTrainers); },[]);
  // 결제수단별 가격: 카드→카드가, 그 외(현금/계좌이체/기타)→현금가. 없으면 기본가로 폴백
  const prodPrice=(p,m)=> (m==='카드'? (p.price_card||p.price||p.price_cash) : (p.price_cash||p.price||p.price_card))||0;
  function pick(p){ setSelProd(p); setName(p.name); setCat(p.category||'PT'); setCnt(String(p.count||0));
    const pr=prodPrice(p,payMethod); if(pr) setPrice(pr.toLocaleString());
    if(p.unlimited){ setEd(''); return; } // 무제한: 만료일 비움
    const base=sd?new Date(sd):new Date();
    if(p.days){ base.setDate(base.getDate()+p.days); setEd(ymd(base)); }
    else if(p.months){ base.setMonth(base.getMonth()+p.months); setEd(ymd(base)); } }
  function changeMethod(m){ setPayMethod(m); if(selProd){ const pr=prodPrice(selProd,m); if(pr) setPrice(pr.toLocaleString()); } }
  const _amt=parseInt((price||'').replace(/\D/g,''))||0;
  const _recRaw=(received||'').replace(/\D/g,'');
  const _rec=_recRaw===''? _amt : (parseInt(_recRaw)||0);
  const _unpaid=Math.max(0,_amt-_rec);
  async function save(){
    if(!name) return setErr('상품명을 입력하세요');
    if(_amt>0 && _rec>_amt) return setErr(`받은 금액이 가격(${_amt.toLocaleString()}원)보다 많습니다. 금액을 확인해주세요.`);
    const total=parseInt(cnt)||0;
    setBusy(true);
    const {data:ins,error}=await sb.from('memberships').insert({member_id:member.id,product_name:name,category:cat,kind:'회차제',total_count:total,remaining_count:total,start_date:sd||null,end_date:ed||null,price:_amt||null,trainer:trainer||null,status:'활성',unpaid:_unpaid||0}).select().single();
    if(error){ setBusy(false); return setErr('저장 실패: '+error.message); }
    // 결제기록 insert 실패를 놓치면 회원권만 생기고 매출에는 안 잡힌다 → 실패 시 알린다.
    if(_rec>0){
      const {error:payErr}=await sb.from('payments').insert({member_id:member.id,membership_id:ins.id,amount:_rec,paid_at:sd||ymd(t),method:_unpaid>0?'일부결제':'등록',pay_method:payMethod});
      if(payErr){ setBusy(false); return setErr(`회원권은 등록됐지만 결제기록 저장에 실패했습니다: ${payErr.message}\n매출에 반영되지 않았으니 결제 내역에서 직접 추가해주세요.`); }
    }
    // 이 갱신이 조용히 실패하면 회원권은 있는데 회원 상태는 '미등록'으로 남는다
    // (자가진단의 '회원 상태 불일치'가 정확히 그 모양이다). 실패하면 알려서 손으로 고치게 한다.
    const {error:stErr}=await sb.from('members').update({status:'활성'}).eq('id',member.id);
    if(stErr) alert(`회원권은 등록됐지만 회원 상태를 '활성'으로 바꾸지 못했습니다.\n${stErr.message}\n\n회원 정보 수정에서 상태를 확인해주세요.`);
    logAct(sb,'회원권 등록',`${member.name} · ${name}${_amt?` · ${_amt.toLocaleString()}원`:''}${_unpaid?` (미수금 ${_unpaid.toLocaleString()}원)`:''}`);
    setBusy(false); onSaved();
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>레슨 / 회원권 등록 · {member.name}</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <div className="preset">{products.length===0? <span className="muted" style={{fontSize:12}}>등록된 상품이 없습니다 · '상품' 탭에서 추가하세요 (직접 입력도 가능)</span> : products.map(p=><button key={p.id} onClick={()=>pick(p)}>{p.name}</button>)}</div>
      <div className="field"><label>상품명</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="예: PT 10회권 / 1:1 레슨"/></div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>총 횟수</label><input type="number" value={cnt} onChange={e=>setCnt(e.target.value)}/></div>
        <div className="field" style={{flex:1}}><label>가격(원)</label><input value={price} onChange={e=>setPrice(fmtNum(e.target.value))} placeholder="1,100,000"/></div>
      </div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>받은 금액(원) <span className="muted" style={{fontWeight:400}}>· 비우면 전액</span></label>
          <input value={received} onChange={e=>setReceived(fmtNum(e.target.value))} placeholder="현장 결제액"/></div>
        <div className="field" style={{width:130}}><label>결제수단</label>
          <select value={payMethod} onChange={e=>changeMethod(e.target.value)}><option>카드</option><option>현금</option><option>계좌이체</option><option>기타</option></select></div>
      </div>
      {selProd && (selProd.price_cash||selProd.price_card) && selProd.price_cash!==selProd.price_card &&
        <div className="muted" style={{fontSize:12,marginTop:-4,marginBottom:8}}>이 상품: 현금가 {(selProd.price_cash||0).toLocaleString()}원 · 카드가 {(selProd.price_card||0).toLocaleString()}원 — 결제수단 바꾸면 가격 자동 변경</div>}
      {_unpaid>0 && <div style={{color:'#d98b7a',fontSize:12,marginTop:-4,marginBottom:8}}>미수금 {_unpaid.toLocaleString()}원 발생 (받은 금액 {_rec.toLocaleString()}원)</div>}
      {_amt>0 && _rec>_amt && <div style={{color:'#e0a23c',fontSize:12,marginTop:-4,marginBottom:8}}>⚠ 받은 금액이 가격보다 {(_rec-_amt).toLocaleString()}원 많습니다 · 확인 후 저장하세요</div>}
      <div className="row2">
        <div className="field" style={{flex:1}}><label>시작일</label><input type="date" value={sd} onChange={e=>setSd(e.target.value)}/></div>
        <div className="field" style={{flex:1}}><label>만료일</label><input type="date" value={ed} onChange={e=>setEd(e.target.value)}/></div>
      </div>
      <TrainerSelect value={trainer} onChange={setTrainer} trainers={trainers}/>
      <button className="btn" disabled={busy} onClick={save}>{busy?'저장 중...':'등록 저장'}</button>
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 회원권 수정/삭제 ----------
function EditMembershipModal({sb,ms,memberName,onClose,onSaved}){
  const who=memberName?memberName+' · ':'';
  useEsc(onClose);
  const [name,setName]=useState(ms.product_name||'');
  const [total,setTotal]=useState(String(ms.total_count||0));
  const [remain,setRemain]=useState(String(ms.remaining_count||0));
  const [ed,setEd]=useState(ms.end_date||'');
  const [trainer,setTrainer]=useState(ms.trainer||'');
  const [trainers,setTrainers]=useState([]);
  const [price,setPrice]=useState(ms.price?ms.price.toLocaleString():'');
  const [status,setStatus]=useState(ms.status||'활성');
  const [unpaid,setUnpaid]=useState(ms.unpaid?ms.unpaid.toLocaleString():'');
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  const [xfer,setXfer]=useState(false),[members,setMembers]=useState([]),[xq,setXq]=useState('');
  useEffect(()=>{ loadActiveTrainerNames(sb).then(list=>setTrainers(ms.trainer && !list.includes(ms.trainer) ? [ms.trainer,...list] : list)); },[]);
  function addMonths(n){ const base=ed?new Date(ed):new Date(); base.setMonth(base.getMonth()+n); setEd(ymd(base)); }
  async function save(){
    setBusy(true);
    const patch={product_name:name,total_count:parseInt(total)||0,remaining_count:parseInt(remain)||0,end_date:ed||null,trainer:trainer||null,price:parseInt((price||'').replace(/\D/g,''))||null,status,unpaid:parseInt((unpaid||'').replace(/\D/g,''))||0};
    // 드롭다운으로 홀딩 상태를 바꿀 때도 전용 버튼과 동일하게 보정
    const wasHold=ms.status==='홀딩', nowHold=status==='홀딩';
    if(nowHold && !wasHold){ patch.hold_start=ymd(new Date()); }
    else if(!nowHold && wasHold){
      patch.hold_start=null;
      if((ed||'')===(ms.end_date||'')){ // 만료일을 직접 수정하지 않았으면 정지기간만큼 자동 연장
        const start=ms.hold_start?new Date(ms.hold_start):new Date();
        const days=Math.max(0,Math.round((Date.now()-start.getTime())/86400000));
        if(ed){ const d=new Date(ed); d.setDate(d.getDate()+days); patch.end_date=ymd(d); }
      }
    }
    const {error}=await sb.from('memberships').update(patch).eq('id',ms.id);
    setBusy(false); if(error){ setErr('저장 실패: '+error.message); return; }
    // 만료일이 늘었으면 '연장'으로 기록 (회원별 이력 카드에 표시됨)
    const extended = ed && ms.end_date && ed>ms.end_date;
    logAct(sb, extended?'회원권 연장':'회원권 수정', extended? `${who}${name} · 만료일 ${ms.end_date} → ${ed}` : `${who}${name}`);
    onSaved();
  }
  async function del(){
    if(!confirm('이 회원권을 삭제할까요? (지난 수업 기록은 남고 차감 연결만 풀립니다)')) return;
    await maybeBeforeDeleteSnapshot(sb);
    const {error}=await sb.from('memberships').delete().eq('id',ms.id);
    if(error){ setErr('삭제 실패: '+error.message); return; }
    logAct(sb,'회원권 삭제',who+ms.product_name);
    onSaved();
  }
  async function toggleHold(){
    if(status==='홀딩'){
      const start=ms.hold_start?new Date(ms.hold_start):new Date();
      const days=Math.max(0,Math.round((Date.now()-start.getTime())/86400000));
      let newEd=ed;
      if(ed){ const d=new Date(ed); d.setDate(d.getDate()+days); newEd=ymd(d); }
      const {error}=await sb.from('memberships').update({status:'활성',hold_start:null,end_date:newEd||null}).eq('id',ms.id);
      if(error){ setErr('해제 실패: '+error.message); return; }
      logAct(sb,'홀딩 해제',`${who}${ms.product_name} · ${days}일 정지 → 만료일 ${newEd||'-'}`);
      onSaved();
    } else {
      if(!confirm('이 회원권을 홀딩(일시정지)할까요?\n해제할 때 정지된 기간만큼 만료일이 자동 연장됩니다.')) return;
      const {error}=await sb.from('memberships').update({status:'홀딩',hold_start:ymd(new Date())}).eq('id',ms.id);
      if(error){ setErr('홀딩 실패: '+error.message); return; }
      logAct(sb,'홀딩',who+ms.product_name);
      onSaved();
    }
  }
  async function openXfer(){ setXfer(v=>!v); if(!members.length){ const {data}=await fetchAll(()=>sb.from('members').select('id,name,phone').order('name').order('id')); setMembers(data||[]); } }
  async function transferTo(m){
    if(!confirm(`이 회원권을 '${m.name}'님에게 양도할까요?`)) return;
    const {error}=await sb.from('memberships').update({member_id:m.id}).eq('id',ms.id);
    if(error){ setErr('양도 실패: '+error.message); return; }
    logAct(sb,'회원권 양도',`${ms.product_name} · ${memberName||'?'} → ${m.name}`);
    onSaved();
  }
  const xcands = xq? members.filter(m=>{const d=xq.replace(/\D/g,'');return (m.name||'').includes(xq)||(d&&(m.phone||'').replace(/\D/g,'').includes(d));}).slice(0,8):[];
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>회원권 수정</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <div className="field"><label>상품명</label><input value={name} onChange={e=>setName(e.target.value)}/></div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>총 횟수</label><input type="number" value={total} onChange={e=>setTotal(e.target.value)}/></div>
        <div className="field" style={{flex:1}}><label>잔여 횟수</label><input type="number" value={remain} onChange={e=>setRemain(e.target.value)}/></div>
      </div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>만료일</label><input type="date" value={ed} onChange={e=>setEd(e.target.value)}/></div>
        <div className="field" style={{flex:1}}><label>상태</label>
          <select value={status} onChange={e=>setStatus(e.target.value)}><option>활성</option><option>홀딩</option><option>만료</option></select></div>
      </div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>가격(원)</label><input value={price} onChange={e=>setPrice(fmtNum(e.target.value))}/></div>
        <div style={{flex:1}}><TrainerSelect value={trainer} onChange={setTrainer} trainers={trainers}/></div>
      </div>
      <div className="field"><label>미수금(원) <span className="muted" style={{fontWeight:400}}>· 수납은 회원 상세의 '미수금 수납' 버튼 사용</span></label><input value={unpaid} onChange={e=>setUnpaid(fmtNum(e.target.value))} placeholder="0"/></div>

      <div style={{borderTop:'1px solid var(--line)',margin:'14px 0 12px',paddingTop:12}}>
        <div className="muted" style={{fontSize:12,marginBottom:8}}>홀딩 · 연장 · 양도</div>
        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8,flexWrap:'wrap'}}>
          <button className="btn ghost sm" onClick={()=>addMonths(1)}>만료일 +1개월</button>
          <button className="btn ghost sm" onClick={()=>addMonths(3)}>+3개월</button>
          <button className="btn ghost sm" onClick={()=>addMonths(6)}>+6개월</button>
          <span className="muted" style={{fontSize:11}}>(저장 눌러야 반영)</span>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button className="btn ghost sm" style={{flex:1}} onClick={toggleHold}>{status==='홀딩'?'▶ 홀딩 해제':'⏸ 홀딩(정지)'}</button>
          <button className={'btn ghost sm'+(xfer?' ':'')} style={{flex:1}} onClick={openXfer}>↔ 양도{xfer?' 닫기':''}</button>
        </div>
        {xfer && <div className="field" style={{marginTop:10,marginBottom:0}}>
          <label>양도 대상 회원 검색</label>
          <input autoFocus value={xq} onChange={e=>setXq(e.target.value)} placeholder="이름 또는 전화번호"/>
          {xcands.map(m=><div key={m.id} className="card" style={{margin:'6px 0 0',cursor:'pointer',padding:'8px 12px'}} onClick={()=>transferTo(m)}><b>{m.name}</b> <span className="muted" style={{fontSize:13}}>{m.phone||''}</span></div>)}
          {xq && xcands.length===0 && <div className="muted" style={{fontSize:13,marginTop:6}}>검색 결과 없음</div>}
        </div>}
      </div>

      <div style={{display:'flex',gap:8,marginTop:6}}>
        <button className="btn" style={{flex:1}} disabled={busy} onClick={save}>{busy?'저장 중...':'저장'}</button>
        <button className="btn ghost" style={{color:'#d98b7a',borderColor:'#5a2e28'}} onClick={del}>삭제</button>
      </div>
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 개인정보 수정 ----------
function EditMemberModal({sb,member,onClose,onSaved}){
  useEsc(onClose);
  const [name,setName]=useState(member.name||'');
  const [phone,setPhone]=useState(member.phone||'');
  const [birth,setBirth]=useState(member.birth||'');
  const [gender,setGender]=useState(member.gender||'');
  const [address,setAddress]=useState(member.address||'');
  const [memo,setMemo]=useState(member.memo||'');
  const [tags,setTags]=useState(member.tags||'');
  const [consentAt,setConsentAt]=useState(member.consent_at||null);
  const [consentMkt,setConsentMkt]=useState(!!member.consent_marketing);
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function save(){
    if(!name.trim()) return setErr('이름을 입력하세요');
    setBusy(true);
    const cleanTags=tags.split(',').map(s=>s.trim()).filter(Boolean).join(', ');
    const {error}=await sb.from('members').update({name:name.trim(),phone:phone||null,birth:birth||null,gender:gender||null,address:address||null,memo:memo||null,tags:cleanTags||null,consent_at:consentAt,consent_marketing:consentMkt}).eq('id',member.id);
    setBusy(false); if(error){ setErr('저장 실패: '+error.message); return; }
    logAct(sb,'회원정보 수정',name.trim());
    onSaved();
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>개인정보 수정</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>이름</label><input value={name} onChange={e=>setName(e.target.value)}/></div>
        <div className="field" style={{width:110}}><label>성별</label>
          <select value={gender} onChange={e=>setGender(e.target.value)}><option value="">-</option><option>남성</option><option>여성</option></select></div>
      </div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>전화번호</label><input value={phone} onChange={e=>setPhone(fmtPhone(e.target.value))} placeholder="010-0000-0000" inputMode="numeric"/></div>
        <div className="field" style={{flex:1}}><label>생년월일</label><input type="date" value={birth} onChange={e=>setBirth(e.target.value)}/></div>
      </div>
      <div className="field"><label>주소</label><input value={address} onChange={e=>setAddress(e.target.value)} placeholder="주소"/></div>
      <div className="field"><label>메모</label><input value={memo} onChange={e=>setMemo(e.target.value)} placeholder="특이사항"/></div>
      <div className="field"><label>태그 <span className="muted">(쉼표로 구분)</span></label><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="예: 재활, 대회준비, 소개고객"/></div>
      <div className="field"><label>개인정보 동의</label>
        <label className="chk"><input type="checkbox" checked={!!consentAt} onChange={e=>setConsentAt(e.target.checked?(member.consent_at||new Date().toISOString()):null)}/> 개인정보 수집·이용 동의 (필수){consentAt && <span className="muted" style={{marginLeft:6,fontSize:12}}>· {fmtDate(consentAt)}</span>}</label>
        <label className="chk" style={{marginTop:4}}><input type="checkbox" checked={consentMkt} onChange={e=>setConsentMkt(e.target.checked)}/> 마케팅 정보 수신 동의 (선택)</label>
      </div>
      <button className="btn" disabled={busy} onClick={save}>{busy?'저장 중...':'저장'}</button>
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 회원 상세 ----------
// ---------- 할일 등록 (Gymdesk 스타일 팔로업) ----------
function TaskModal({sb,member,initTitle,onClose,onSaved}){
  useEsc(onClose);
  const {role,name:myName}=usePerm();
  const [title,setTitle]=useState(initTitle||'');
  const [due,setDue]=useState(ymd(new Date()));
  const [assignee,setAssignee]=useState(myName||'');
  const [staffNames,setStaffNames]=useState(null);
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{
    if(role!=='master'){ setStaffNames(myName?[myName]:[]); return; }
    sb.from('staff').select('name,active').eq('active',true).then(({data})=>{
      const ns=[...new Set((data||[]).map(r=>String(r.name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
      setStaffNames(ns.length?ns:(myName?[myName]:[]));
    });
  },[]);
  async function save(){
    const t=title.trim(); if(!t){ setErr('할 일 내용을 입력하세요.'); return; }
    setBusy(true);
    const {error}=await sb.from('tasks').insert({member_id:member?member.id:null,title:t,due_date:due||null,assignee:assignee||null,created_by:myName||null});
    setBusy(false);
    if(error){ setErr('저장 실패: '+error.message+(/does not exist|schema cache/i.test(error.message)?' (db/notes_tasks.sql 실행 필요)':'')); return; }
    logAct(sb,'할일 등록',`${assignee||'-'} · ${t}${member?` (${member.name})`:''}`);
    onSaved();
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>할 일 등록</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      {member && <p className="muted" style={{fontSize:12,marginTop:0}}>관련 회원: <b>{member.name}</b></p>}
      <div className="field"><label>할 일</label><input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="예: 재등록 상담 전화"/></div>
      <div className="field"><label>기한</label><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></div>
      <div className="field"><label>담당</label>
        {role==='master'
          ? <select value={assignee} onChange={e=>setAssignee(e.target.value)}>
              {(staffNames||[]).map(n=><option key={n} value={n}>{n}</option>)}
              {assignee && staffNames && !staffNames.includes(assignee) && <option value={assignee}>{assignee}</option>}
            </select>
          : <input value={assignee} disabled/>}
      </div>
      <button className="btn" disabled={busy} onClick={save}>{busy?'저장 중...':'등록'}</button>
      <div className="err">{err}</div>
    </div></div>
  );
}

function Detail({sb,member:m0,onClose,panel,panelTop}){
  const {can,role,name:myName}=usePerm();
  const [member,setMember]=useState(m0);
  const [trainerOpts,setTrainerOpts]=useState([]);
  const [ms,setMs]=useState(null),[ls,setLs]=useState(null),[pays,setPays]=useState(null),[myLockers,setMyLockers]=useState([]);
  const [reg,setReg]=useState(false),[editMs,setEditMs]=useState(null),[editMember,setEditMember]=useState(false);
  const [lessonTab,setLessonTab]=useState('upcoming');
  const [showHistory,setShowHistory]=useState(false),[lockerPick,setLockerPick]=useState(false),[collect,setCollect]=useState(false);
  const [refund,setRefund]=useState(null);
  const [editPay,setEditPay]=useState(null);
  const [hist,setHist]=useState(null);
  const [notes,setNotes]=useState(null),[noteBody,setNoteBody]=useState(''),[noteBusy,setNoteBusy]=useState(false),[noteKind,setNoteKind]=useState('상담');
  const [taskModal,setTaskModal]=useState(null); // {initTitle}
  useEsc((reg||editMs||editMember||showHistory||lockerPick||collect||refund||editPay||taskModal) ? (()=>{}) : onClose);
  async function reload(){
    const a=await sb.from('memberships').select('*').eq('member_id',member.id).order('end_date',{ascending:false});
    setMs(a.data||[]);
    const b=await sb.from('lessons').select('*').eq('member_id',member.id).order('start_at',{ascending:false}).limit(200);
    setLs(b.data||[]);
    const c=await sb.from('payments').select('*').eq('member_id',member.id).order('paid_at',{ascending:false});
    setPays(c.data||[]);
    const d=await sb.from('lockers').select('*').eq('member_id',member.id).order('number');
    setMyLockers(d.data||[]);
    const h=await sb.from('logs').select('*').in('action',['홀딩','홀딩 해제','회원권 양도','회원권 연장']).ilike('detail',`%${member.name}%`).order('at',{ascending:false}).limit(30);
    setHist(h.data||[]);
    const n=await sb.from('member_notes').select('*').eq('member_id',member.id).order('at',{ascending:false}).limit(100);
    setNotes(n.error?'na':(n.data||[]));
  }
  async function addNote(){
    const body=noteBody.trim(); if(!body||noteBusy) return;
    setNoteBusy(true);
    const {error}=await sb.from('member_notes').insert({member_id:member.id,body,author:myName||null,kind:noteKind});
    setNoteBusy(false);
    if(error) return alert('노트 저장 실패: '+error.message+(/does not exist|schema cache/i.test(error.message)?' (db/notes_tasks.sql 실행 필요)':''));
    logAct(sb,'노트 작성',`${member.name}${noteKind?` · ${noteKind}`:''}`);
    setNoteBody(''); reload();
  }
  async function delNote(n){
    if(!confirm('이 노트를 삭제할까요?')) return;
    const {error}=await sb.from('member_notes').delete().eq('id',n.id);
    if(error) return alert('삭제 실패: '+error.message);
    logAct(sb,'노트 삭제',member.name);
    reload();
  }
  async function delMember(){
    if(!confirm(`'${member.name}' 회원을 삭제할까요?\n\n· 보유 회원권도 함께 삭제됩니다\n· 수업/결제 기록은 남지만 회원 연결이 해제됩니다\n· 배정된 락커는 자동 회수됩니다\n\n이 작업은 되돌릴 수 없습니다.`)) return;
    await sb.from('lockers').update({member_id:null,status:'미배정',start_date:null,end_date:null,unlimited:false,password:null,memo:null}).eq('member_id',member.id);
    await maybeBeforeDeleteSnapshot(sb);
    const {error}=await sb.from('members').delete().eq('id',member.id);
    if(error) return alert('삭제 실패: '+error.message);
    logAct(sb,'회원 삭제',member.name);
    onClose();
  }
  async function reloadMember(){ const {data}=await sb.from('members').select('*').eq('id',member.id).single(); if(data) setMember(data); }
  async function assignTrainer(v){ await sb.from('members').update({assigned_trainer:v||null}).eq('id',member.id); logAct(sb,'담당 변경',`${member.name} → ${v||'미배정'}`); reloadMember(); }
  // 동의서 서명 링크(1회용 토큰): 회원 기기에서 로그인 없이 서명 → consent_at 기록
  async function makeConsentLink(){
    const token=crypto.randomUUID();
    const {error}=await sb.from('members').update({consent_token:token}).eq('id',member.id);
    if(error) return alert('링크 생성 실패: '+error.message+(/consent_token|schema cache/i.test(error.message)?' (db/tags_payroll_consent.sql 실행 필요)':''));
    logAct(sb,'동의링크 생성',member.name);
    const cfg=btoa((localStorage.getItem(LS.url)||'')+'|'+(localStorage.getItem(LS.key)||''));
    const link=`${location.origin}${location.pathname}?consent=${token}#cfg=${cfg}`;
    try{ await navigator.clipboard.writeText(link); alert('서명 링크가 복사되었습니다.\n회원 기기(태블릿·폰) 브라우저에 붙여넣어 열면 서명 페이지가 나옵니다.\n링크는 1회용이며 서명 후 자동 만료됩니다.'); }
    catch(e){ prompt('아래 링크를 복사해 회원 기기에서 열어주세요 (1회용)', link); }
  }
  useEffect(()=>{ reload(); },[member.id]);
  useEffect(()=>{ if(role!=='master') return;
    sb.from('memberships').select('trainer').not('trainer','is',null).limit(5000).then(({data})=>{
      setTrainerOpts([...new Set((data||[]).map(r=>String(r.trainer).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'))); });
  },[role]);
  const nowISO=new Date().toISOString();
  const upcoming=(ls||[]).filter(l=>l.status==='예약'&&l.start_at>=nowISO).slice().sort((a,b)=>a.start_at<b.start_at?-1:1);
  const past=(ls||[]).filter(l=>!(l.status==='예약'&&l.start_at>=nowISO));
  const lessonList = lessonTab==='upcoming'? upcoming : past;
  const num=(member.phone||'').replace(/\D/g,'').slice(-4);
  const initials=(member.name||'?').trim().slice(0,2);
  const daysSince = member.reg_date && !isNaN(new Date(member.reg_date)) ? Math.max(0,Math.floor((Date.now()-new Date(member.reg_date))/86400000)) : null;
  const _t0=new Date(); const _today0=new Date(_t0.getFullYear(),_t0.getMonth(),_t0.getDate());
  const dday = end => { if(!end) return null; const d=new Date(end); if(isNaN(d)) return null; return Math.ceil((new Date(d.getFullYear(),d.getMonth(),d.getDate())-_today0)/86400000); };
  const validCnt=(ms||[]).filter(m=>m.status==='활성'||m.status==='홀딩').length;
  const expiredCnt=(ms||[]).filter(m=>m.status!=='활성'&&m.status!=='홀딩').length;
  const unpaidTotal=(ms||[]).reduce((s,m)=>s+(m.unpaid||0),0);
  // 노쇼 이력 — 날짜·수업·몇 회차였는지·사유.
  // ★'회차'는 저장돼 있지 않다. 같은 회원권에 묶인 수업을 시간순으로 세어 순번을 만든다
  //   (회원권이 연결 안 된 이전분 수업은 순번을 낼 수 없어 '-'로 둔다).
  const noshows=useMemo(()=>{
    const all=(ls||[]);
    const seq={};                                  // lesson.id → 그 회원권에서 몇 번째 수업인지
    const byMs={};
    all.forEach(l=>{ if(l.membership_id) (byMs[l.membership_id]=byMs[l.membership_id]||[]).push(l); });
    Object.values(byMs).forEach(list=>{
      list.slice().sort((a,b)=>a.start_at<b.start_at?-1:1).forEach((l,i)=>{ seq[l.id]=i+1; });
    });
    const msName={}; (ms||[]).forEach(m=>msName[m.id]={name:m.product_name,total:m.total_count});
    return all.filter(l=>l.status==='노쇼')
      .sort((a,b)=>a.start_at<b.start_at?1:-1)
      .map(l=>({...l, seq:seq[l.id]||null, ms:l.membership_id?msName[l.membership_id]:null}));
  },[ls,ms]);
  return createPortal((<>
    {panel && <div className="mpage-panel-ov" style={{top:panelTop}} onClick={onClose}/>}
    <div className={'mpage'+(panel?' mpage-panel':'')} style={panel?{top:panelTop}:undefined}>
      <div className="mpage-top">
        <h2>{member.name} <span className={'badge b-'+(member.status||'')}>{member.status||'-'}</span></h2>
        <button className="mpage-close" onClick={onClose} title="닫기">✕</button>
      </div>
      <div className="mp-body">
        <div className="mp-left">
          <div className="mp-avatar">{initials}</div>
          <div className="mp-name">{member.name} {num && <small>· {num}</small>}</div>
          <div className="mp-chips"><span className={'badge b-'+(member.status||'')}>{member.status||'-'}</span></div>
          <div className="mp-acts">
            <button className="btn" style={{flex:1}} onClick={()=>setReg(true)}>＋ 레슨 등록</button>
            <button className="btn ghost" style={{flex:1}} onClick={()=>setEditMember(true)}>정보 수정</button>
          </div>
          <div className="mp-info">
            <div className="kv"><span>성별</span><b>{member.gender||'-'}</b></div>
            <div className="kv"><span>생년월일</span><b>{member.birth||'-'}{age(member.birth)?` (${age(member.birth)})`:''}</b></div>
            <div className="kv"><span>연락처</span><b>{member.phone||'-'}</b></div>
            <div className="kv"><span>주소</span><b>{member.address||'-'}</b></div>
            <div className="kv"><span>등록일</span><b>{fmtDate(member.reg_date)}{daysSince!=null?` · ${daysSince}일`:''}</b></div>
            <div className="kv"><span>누적결제</span><b>{(member.cumulative_payment||0).toLocaleString()}원</b></div>
            <div className="kv"><span>상담담당</span><b>{member.manager||'-'}</b></div>
            <div className="kv"><span>담당 선생님</span>
              {role==='master'
                ? <select value={member.assigned_trainer||''} onChange={e=>assignTrainer(e.target.value)}
                    style={{background:'var(--forest)',border:'1px solid var(--line)',borderRadius:8,padding:'5px 8px',color:'var(--cream)',fontSize:13,cursor:'pointer',maxWidth:130}}>
                    <option value="">(미배정)</option>
                    {trainerOpts.map(t=><option key={t} value={t}>{t}</option>)}
                    {member.assigned_trainer && !trainerOpts.includes(member.assigned_trainer) && <option value={member.assigned_trainer}>{member.assigned_trainer}</option>}
                  </select>
                : <b>{member.assigned_trainer||'-'}</b>}
            </div>
            <div className="kv"><span>개인정보 동의</span>
              {member.consent_at
                ? <b style={{color:'#7dc4a0'}}>동의 · {fmtDate(member.consent_at)}{member.consent_marketing?' · 마케팅':''}</b>
                : <b style={{color:'#d98b7a'}}>미확보 {can('members') && <button className="link" style={{margin:'0 0 0 4px',fontSize:12}} title="회원 기기에서 로그인 없이 서명받는 1회용 링크" onClick={makeConsentLink}>서명 링크</button>}</b>}
            </div>
            {member.tags && <div className="kv"><span>태그</span>
              <b>{member.tags.split(',').map(s=>s.trim()).filter(Boolean).map(t=><span key={t} className="tagchip">{t}</span>)}</b></div>}
            <div className="kv"><span>락커</span>
              <b style={{cursor:'pointer',color:'var(--brass)',textDecoration:'underline'}} onClick={()=>setLockerPick(true)} title="클릭하여 락커 지정/변경">
                {myLockers.length? myLockers.map(l=>l.number+'번').join(', ') : '지정하기 +'}</b></div>
            {member.memo && <div className="kv"><span>메모</span><b>{member.memo}</b></div>}
          </div>
          {can('delete_members') && <button className="btn ghost danger sm" style={{width:'100%',marginTop:16}} onClick={delMember}>회원 삭제</button>}
        </div>
        <div className="mp-grid">
          <div className="mp-cardbox">
            <h3><span>회원권 현황</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>유효 {validCnt} · 만료 {expiredCnt}</span></h3>
            {ms===null? <div className="muted">불러오는 중...</div> :
              ms.length===0? <div className="muted">보유 회원권이 없습니다</div> :
              ms.map(m=>{ const t=m.total_count||0,r=m.remaining_count||0,used=Math.max(0,t-r); const d=dday(m.end_date);
                return (<div className="ms-row" key={m.id} onClick={()=>setEditMs(m)} title="클릭 시 수정">
                  <div className="kv"><b>{m.product_name} <span className={'badge b-'+(m.status||'')}>{m.status||'-'}</span></b>
                    {d!=null && <span className={'dday'+(d<0?' expired':'')}>{d<0?'만료':d===0?'오늘 만료':`${d}일 남음`}</span>}</div>
                  <div className="kv" style={{marginTop:2}}><span>{fmtDate(m.start_date)} ~ {fmtDate(m.end_date)}</span><b>{r} / {t} <span className="muted">(사용 {used})</span></b></div>
                  <div className="gauge"><i style={{width:(t?Math.round(r/t*100):0)+'%'}}/></div>
                  {m.unpaid>0 && <div className="kv" style={{marginTop:6}}><span style={{color:'#d98b7a'}}>미수금</span><b style={{color:'#d98b7a'}}>{m.unpaid.toLocaleString()}원</b></div>}
                </div>); })}
          </div>
          <div className="mp-cardbox">
            <h3><span>예약 내역 {ls?`(${ls.length})`:''}</span>{ls&&ls.length>0 && <button className="btn ghost sm" onClick={()=>setShowHistory(true)}>전체보기 ⤢</button>}</h3>
            <div className="seg" style={{marginBottom:10}}>
              <button className={lessonTab==='upcoming'?'on':''} onClick={()=>setLessonTab('upcoming')}>예정 {upcoming.length}</button>
              <button className={lessonTab==='past'?'on':''} onClick={()=>setLessonTab('past')}>지난 {past.length}</button>
            </div>
            {ls===null? <div className="muted">불러오는 중...</div> :
              lessonList.length===0? <div className="muted">{lessonTab==='upcoming'?'예정된 예약이 없습니다':'지난 수업 기록이 없습니다'}</div> :
              lessonList.slice(0,8).map(l=>(<div className="card" key={l.id} style={{padding:'9px 14px'}}>
                <div className="kv"><b>{l.lesson_name||'수업'} <span className={'mini '+l.status}>{l.status}</span></b><span>{fmtDT(l.start_at)}</span></div>
                <div className="kv"><span>{l.trainer||'-'}</span><span>{l.noshow_reason?('노쇼: '+l.noshow_reason):(l.price?l.price.toLocaleString()+'원':'')}</span></div>
              </div>))}
            {ls && lessonList.length>8 && <button className="link" style={{marginTop:4}} onClick={()=>setShowHistory(true)}>+ {lessonList.length-8}건 더보기</button>}
          </div>
          <div className="mp-cardbox">
            <h3><span>결제 내역 {pays?`(${pays.length})`:''}</span>{unpaidTotal>0 && can('refund') && <button className="btn ghost sm" style={{color:'#d98b7a',borderColor:'#5a2e28'}} onClick={()=>setCollect(true)}>미수금 {unpaidTotal.toLocaleString()}원 수납</button>}</h3>
            {pays===null? <div className="muted">불러오는 중...</div> :
              pays.length===0? <div className="muted">결제 내역이 없습니다</div> :
              <table className="ptable"><thead><tr><th>거래일시</th><th>구분</th><th style={{textAlign:'right'}}>금액</th><th style={{width:50}}></th></tr></thead>
                <tbody>{pays.map(p=>(<tr key={p.id}>
                  <td>{fmtDate(p.paid_at)}</td>
                  <td style={p.amount<0?{color:'#d98b7a'}:undefined}>{p.method||'-'}</td>
                  <td style={{textAlign:'right',color:p.amount<0?'#d98b7a':undefined}}>{(p.amount||0).toLocaleString()}원</td>
                  <td style={{textAlign:'right',whiteSpace:'nowrap'}}>
                    <button className="link" style={{margin:0,fontSize:12}} onClick={()=>setEditPay(p)}>수정</button>
                    {p.amount>0 && can('refund')? <button className="link" style={{margin:'0 0 0 8px',fontSize:12}} onClick={()=>setRefund(p)}>환불</button> : null}</td>
                </tr>))}</tbody></table>}
          </div>
          <div className="mp-cardbox">
            <h3><span>✗ 노쇼 이력</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600,
              color:noshows.length?'#d98b7a':undefined}}>{ls===null?'':noshows.length+'건'}</span></h3>
            {ls===null? <div className="muted">불러오는 중...</div> :
              noshows.length===0? <div className="muted">노쇼 기록이 없습니다.<br/><span style={{fontSize:12}}>(캘린더에서 노쇼 처리하면 날짜·회차·사유가 여기에 쌓입니다)</span></div> :
              <table className="ptable nstable">
                <thead><tr><th>날짜</th><th>수업</th><th>회차</th><th>사유</th></tr></thead>
                <tbody>{noshows.map(l=>(<tr key={l.id}>
                  <td style={{whiteSpace:'nowrap'}}>{fmtDate(l.start_at)}<br/><span className="muted" style={{fontSize:11}}>{hm(l.start_at)}</span></td>
                  <td>{l.lesson_name||'수업'}<br/><span className="muted" style={{fontSize:11}}>{l.trainer||'강사 미지정'}</span></td>
                  <td style={{whiteSpace:'nowrap'}}>{l.seq? <>{l.seq}회차{l.ms&&l.ms.total?<span className="muted">/{l.ms.total}</span>:null}<br/><span className="muted" style={{fontSize:11}}>{l.ms?l.ms.name:''}</span></> : <span className="muted">-</span>}</td>
                  <td style={{color:l.noshow_reason?'var(--cream)':'var(--muted)'}}>{l.noshow_reason||'사유 없음'}</td>
                </tr>))}</tbody>
              </table>}
            {noshows.length>0 && <p className="muted" style={{fontSize:12,margin:'8px 0 0'}}>
              노쇼는 회차가 차감된 상태로 남습니다. 되돌리려면 캘린더에서 '휴강'으로 바꾸면 +1 복구됩니다.</p>}
          </div>
          <div className="mp-cardbox">
            <h3><span>홀딩 · 연장 · 양도 이력</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{hist?hist.length+'건':''}</span></h3>
            {hist===null? <div className="muted">불러오는 중...</div> :
              hist.length===0? <div className="muted">이력이 없습니다. 앞으로의 홀딩·연장·양도가 여기에 기록됩니다.</div> :
              hist.map(l=>(<div className="card" key={l.id} style={{padding:'8px 14px'}}>
                <div className="kv"><b>{l.action}</b><span>{fmtDT(l.at)}</span></div>
                <div className="muted" style={{fontSize:13}}>{l.detail||''}</div>
              </div>))}
          </div>
          <div className="mp-cardbox">
            <h3><span>📝 노트 {Array.isArray(notes)?`(${notes.length})`:''}</span>
              <button className="btn ghost sm" onClick={()=>setTaskModal({initTitle:''})}>＋ 할일</button></h3>
            <div className="note-kinds">
              {['상담','부상','기타'].map(k=><button key={k} type="button" className={'notekind-pick k-'+k+(noteKind===k?' on':'')} onClick={()=>setNoteKind(k)}>{k==='부상'?'⚠ 부상':k}</button>)}
            </div>
            <div className="note-add">
              <textarea rows={2} value={noteBody} onChange={e=>setNoteBody(e.target.value)} placeholder={noteKind==='부상'?'부상·통증 부위, 주의사항 (항상 상단 고정됩니다)':'상담 내용·특이사항 기록 (날짜·작성자 자동 저장)'}/>
              <button className="btn sm" disabled={noteBusy||!noteBody.trim()} onClick={addNote}>{noteBusy?'저장...':'저장'}</button>
            </div>
            {notes===null? <div className="muted">불러오는 중...</div> :
              notes==='na'? <div className="muted">노트 기능을 사용하려면 db/notes_tasks.sql을 Supabase SQL 에디터에서 실행하세요.</div> :
              notes.length===0? <div className="muted">아직 노트가 없습니다. 기록하면 시간순으로 쌓입니다.</div> :
              notes.slice().sort((a,b)=>((b.kind==='부상')-(a.kind==='부상'))||(a.at<b.at?1:-1)).map(n=>(<div className={'card note-card'+(n.kind==='부상'?' injury':'')} key={n.id} style={{padding:'9px 14px'}}>
                <div style={{whiteSpace:'pre-wrap',fontSize:14}}>{n.kind && <span className={'notekind k-'+n.kind}>{n.kind==='부상'?'⚠ 부상':n.kind}</span>}{n.body}</div>
                <div className="kv" style={{marginTop:6}}>
                  <span className="muted" style={{fontSize:12}}>{n.author||'-'} · {fmtDT(n.at)}</span>
                  <span style={{whiteSpace:'nowrap'}}>
                    <button className="link" style={{margin:0,fontSize:12}} title="이 노트로 팔로업 할일 만들기" onClick={()=>setTaskModal({initTitle:n.body.slice(0,60)})}>할일↗</button>
                    {(role==='master'||n.author===myName) && <button className="link" style={{margin:'0 0 0 8px',fontSize:12,color:'#d98b7a'}} onClick={()=>delNote(n)}>삭제</button>}
                  </span>
                </div>
              </div>))}
          </div>
        </div>
      </div>
    </div>
    {reg && <RegisterModal sb={sb} member={member} onClose={()=>setReg(false)} onSaved={()=>{setReg(false);reload();reloadMember();}}/>}
    {editMs && <EditMembershipModal sb={sb} ms={editMs} memberName={member.name} onClose={()=>setEditMs(null)} onSaved={()=>{setEditMs(null);reload();}}/>}
    {editMember && <EditMemberModal sb={sb} member={member} onClose={()=>setEditMember(false)} onSaved={()=>{setEditMember(false);reloadMember();}}/>}
    {showHistory && <LessonHistoryModal member={member} lessons={ls||[]} memberships={ms||[]} initialTab={lessonTab} onClose={()=>setShowHistory(false)}/>}
    {lockerPick && <LockerPickModal sb={sb} member={member} onClose={()=>setLockerPick(false)} onSaved={()=>{setLockerPick(false);reload();}}/>}
    {collect && <CollectModal sb={sb} member={member} memberships={ms||[]} onClose={()=>setCollect(false)} onSaved={()=>{reload();}}/>}
    {refund && <RefundModal sb={sb} member={member} payment={refund} pays={pays||[]} onClose={()=>setRefund(null)} onSaved={()=>{setRefund(null);reload();}}/>}
    {editPay && <EditPaymentModal sb={sb} member={member} payment={editPay} onClose={()=>setEditPay(null)} onSaved={()=>{setEditPay(null);reload();}}/>}
    {taskModal && <TaskModal sb={sb} member={member} initTitle={taskModal.initTitle} onClose={()=>setTaskModal(null)} onSaved={()=>setTaskModal(null)}/>}
  </>), document.body);
}

// ---------- 환불 ----------
function RefundModal({sb,member,payment,pays,onClose,onSaved}){
  useEsc(onClose);
  // 같은 회원권(없으면 같은 회원)에 이미 환불된 합계.
  // ★ 원 결제액만 보고 막으면 같은 결제를 두 번 환불할 수 있다(매출이 음수로 남음).
  //   환불행에는 원거래를 가리키는 키가 없어서 회원권 단위로 집계해 상한을 잡는다.
  const sameKey = p => payment.membership_id
    ? p.membership_id===payment.membership_id
    : (!p.membership_id && p.member_id===payment.member_id);
  const scope=(pays||[]).filter(sameKey);
  const paidSum   = scope.filter(p=>(p.amount||0)>0).reduce((s,p)=>s+p.amount,0);
  const refundSum = scope.filter(p=>(p.amount||0)<0).reduce((s,p)=>s-p.amount,0);
  const refundable= Math.max(0, Math.min(payment.amount||0, paidSum-refundSum));
  const [amt,setAmt]=useState(refundable.toLocaleString());
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function save(){
    const a=parseInt((amt||'').replace(/\D/g,''))||0;
    if(a<=0) return setErr('환불액을 입력하세요');
    if(a>payment.amount) return setErr(`원 결제액(${payment.amount.toLocaleString()}원)보다 많습니다`);
    if(a>refundable) return setErr(refundable===0
      ? `이미 전액 환불됐습니다. (결제 ${paidSum.toLocaleString()}원 · 환불 ${refundSum.toLocaleString()}원)`
      : `환불 가능액을 넘습니다. 남은 환불 가능액 ${refundable.toLocaleString()}원 (결제 ${paidSum.toLocaleString()}원 · 이미 환불 ${refundSum.toLocaleString()}원)`);
    setBusy(true);
    const {error}=await sb.from('payments').insert({member_id:payment.member_id,membership_id:payment.membership_id||null,amount:-a,paid_at:ymd(new Date()),method:'환불',pay_method:payment.pay_method||null});
    setBusy(false);
    if(error) return setErr('환불 실패: '+error.message);
    logAct(sb,'환불',`${member.name} · ${a.toLocaleString()}원 (원거래 ${fmtDate(payment.paid_at)} · ${payment.method||'-'})`);
    onSaved();
  }
  return (<div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="mhead"><h3>환불 · {member.name}</h3><button className="xbtn" onClick={onClose}>✕</button></div>
    <p className="muted" style={{fontSize:13,marginTop:0}}>원거래: {fmtDate(payment.paid_at)} · {payment.method||'-'} · {(payment.amount||0).toLocaleString()}원{payment.pay_method?` (${payment.pay_method})`:''}</p>
    <div className="field"><label>환불액(원)</label><input autoFocus value={amt} onChange={e=>setAmt(fmtNum(e.target.value))}/></div>
    <p className="muted" style={{fontSize:12,margin:'0 0 10px'}}>남은 환불 가능액 <b>{refundable.toLocaleString()}원</b>{refundSum>0?` (이미 ${refundSum.toLocaleString()}원 환불됨)`:''}. 환불은 매출에 음수로 기록되어 합계에서 차감됩니다. 회원권 잔여횟수·만료일은 바뀌지 않으니 필요하면 회원권 수정에서 조정하세요.</p>
    {err && <div className="err">{err}</div>}
    <button className="btn" style={{width:'100%'}} disabled={busy} onClick={save}>{busy?'처리 중...':'환불 처리'}</button>
  </div></div>);
}

// ---------- 결제내역 수정 ----------
function EditPaymentModal({sb,member,payment,onClose,onSaved}){
  useEsc(onClose);
  const sign = (payment.amount||0)<0? -1 : 1; // 환불(음수) 행은 부호 유지
  const [amt,setAmt]=useState(Math.abs(payment.amount||0).toLocaleString());
  const [date,setDate]=useState(payment.paid_at||'');
  const METHODS=['등록','일부결제','미수금수납','환불','기타'];
  const [method,setMethod]=useState(METHODS.includes(payment.method)?payment.method:(payment.method||'기타'));
  const [payMethod,setPayMethod]=useState(payment.pay_method||'');
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function save(){
    const a=parseInt((amt||'').replace(/\D/g,''))||0;
    if(a<=0) return setErr('금액을 입력하세요');
    if(!date) return setErr('거래일을 입력하세요');
    setBusy(true);
    const {error}=await sb.from('payments').update({amount:sign*a,paid_at:date,method,pay_method:payMethod||null}).eq('id',payment.id);
    setBusy(false); if(error) return setErr('저장 실패: '+error.message);
    logAct(sb,'결제내역 수정',`${member.name} · ${fmtDate(date)} · ${method} · ${(sign*a).toLocaleString()}원 (원래 ${(payment.amount||0).toLocaleString()}원)`);
    onSaved();
  }
  async function del(){
    if(!confirm(`이 결제내역을 삭제할까요?\n${fmtDate(payment.paid_at)} · ${payment.method||'-'} · ${(payment.amount||0).toLocaleString()}원\n\n매출 집계에서도 빠집니다. 되돌릴 수 없습니다.`)) return;
    await maybeBeforeDeleteSnapshot(sb);
    const {error}=await sb.from('payments').delete().eq('id',payment.id);
    if(error) return setErr('삭제 실패: '+error.message);
    logAct(sb,'결제내역 삭제',`${member.name} · ${fmtDate(payment.paid_at)} · ${(payment.amount||0).toLocaleString()}원`);
    onSaved();
  }
  return (<div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="mhead"><h3>결제내역 수정 · {member.name}</h3><button className="xbtn" onClick={onClose}>✕</button></div>
    {sign<0 && <p className="muted" style={{fontSize:12,marginTop:0}}>환불 거래입니다 — 금액은 자동으로 음수(-)로 저장됩니다.</p>}
    <div className="row2">
      <div className="field" style={{flex:1}}><label>거래일</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
      <div className="field" style={{flex:1}}><label>금액(원)</label><input value={amt} onChange={e=>setAmt(fmtNum(e.target.value))}/></div>
    </div>
    <div className="row2">
      <div className="field" style={{flex:1}}><label>구분</label>
        <select value={method} onChange={e=>setMethod(e.target.value)}>{['등록','일부결제','미수금수납','환불','기타'].concat(['등록','일부결제','미수금수납','환불','기타'].includes(method)?[]:[method]).map(m=><option key={m}>{m}</option>)}</select></div>
      <div className="field" style={{flex:1}}><label>결제수단</label>
        <select value={payMethod} onChange={e=>setPayMethod(e.target.value)}><option value="">미지정</option><option>카드</option><option>현금</option><option>계좌이체</option><option>기타</option></select></div>
    </div>
    {err && <div className="err">{err}</div>}
    <div style={{display:'flex',gap:8,marginTop:6}}>
      <button className="btn" style={{flex:1}} disabled={busy} onClick={save}>{busy?'저장 중...':'저장'}</button>
      <button className="btn ghost" style={{color:'#d98b7a',borderColor:'#5a2e28'}} onClick={del}>삭제</button>
    </div>
  </div></div>);
}

// ---------- 미수금 수납 ----------
function CollectModal({sb,member,memberships,onClose,onSaved}){
  useEsc(onClose);
  const unpaidMs=(memberships||[]).filter(m=>(m.unpaid||0)>0);
  const [amts,setAmts]=useState(()=>Object.fromEntries(unpaidMs.map(m=>[m.id,(m.unpaid||0).toLocaleString()])));
  const [payMethod,setPayMethod]=useState('카드');
  const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[done,setDone]=useState({});
  const inpStyle={flex:1,background:'var(--forest)',border:'1px solid var(--line)',borderRadius:8,padding:'9px 11px',color:'var(--cream)',fontSize:14};
  async function collectOne(m){
    setErr('');
    const rec=parseInt((amts[m.id]||'').replace(/\D/g,''))||0;
    if(rec<=0) return setErr('수납액을 입력하세요');
    if(rec>m.unpaid) return setErr(`미수금(${m.unpaid.toLocaleString()}원)보다 많이 입력했습니다`);
    setBusy(true);
    // ★ 순서 주의: 결제기록을 먼저 넣고 그 다음 미수금을 줄인다.
    //   반대로 하면 결제 insert가 실패했을 때 미수금만 줄어들어 '받은 돈이 장부에서 사라진다'.
    //   이 순서면 최악의 경우에도 결제는 남고 미수금이 안 줄어든 상태 = 눈에 보이고 고칠 수 있다.
    const {error:payErr}=await sb.from('payments').insert({member_id:member.id,membership_id:m.id,amount:rec,paid_at:ymd(new Date()),method:'미수금수납',pay_method:payMethod});
    if(payErr){ setBusy(false); return setErr('결제기록 저장 실패: '+payErr.message); }
    const {error}=await sb.from('memberships').update({unpaid:m.unpaid-rec}).eq('id',m.id);
    if(error){ setBusy(false); return setErr(`결제는 기록됐지만 미수금 차감에 실패했습니다: ${error.message}\n회원권 수정에서 미수금을 직접 조정해주세요.`); }
    logAct(sb,'미수금 수납',`${member.name} · ${m.product_name} · ${rec.toLocaleString()}원 (${payMethod})`);
    setBusy(false); setDone(d=>({...d,[m.id]:rec})); onSaved();
  }
  return (<div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="mhead"><h3>미수금 수납 · {member.name}</h3><button className="xbtn" onClick={onClose}>✕</button></div>
    <div className="field"><label>결제수단</label><select value={payMethod} onChange={e=>setPayMethod(e.target.value)}><option>카드</option><option>현금</option><option>계좌이체</option><option>기타</option></select></div>
    {unpaidMs.length===0? <div className="muted" style={{padding:'16px 0'}}>미수금이 없습니다</div> :
      unpaidMs.map(m=>(<div className="card" key={m.id}>
        <div className="kv"><b>{m.product_name}</b><span style={{color:done[m.id]?'#7dc4a0':'#d98b7a'}}>{done[m.id]?`수납 완료 (${done[m.id].toLocaleString()}원)`:`미수금 ${m.unpaid.toLocaleString()}원`}</span></div>
        {!done[m.id] && <div style={{display:'flex',gap:6,marginTop:8}}>
          <input style={inpStyle} value={amts[m.id]||''} onChange={e=>setAmts(a=>({...a,[m.id]:fmtNum(e.target.value)}))} placeholder="수납액(원)"/>
          <button className="btn sm" disabled={busy} onClick={()=>collectOne(m)}>수납</button>
        </div>}
      </div>))}
    <div className="err">{err}</div>
    <p className="muted" style={{fontSize:12,marginTop:4,marginBottom:0}}>수납하면 결제 내역·매출에 반영되고 미수금이 줄어듭니다.</p>
  </div></div>);
}

// ---------- 락커 지정 모달 (회원 상세에서, BroJ '락커 수정' 스타일) ----------
function LockerPickModal({sb,member,onClose,onSaved}){
  useEsc(onClose);
  const [lockers,setLockers]=useState(null);
  const [members,setMembers]=useState([]);
  const [sel,setSel]=useState(null);
  const [sd,setSd]=useState(ymd(new Date())),[ed,setEd]=useState(''),[unlimited,setUnlimited]=useState(false),[pw,setPw]=useState('');
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{
    sb.from('lockers').select('*').eq('room','개인라커').order('number').then(({data})=>setLockers(data||[]));
    fetchAll(()=>sb.from('members').select('id,name').order('name').order('id')).then(({data})=>setMembers(data||[]));
  },[]);
  const nameById=useMemo(()=>{const m={};members.forEach(x=>m[x.id]=x.name);return m;},[members]);
  function st(l){ if(l.status==='고장')return 'broken'; if(!l.member_id)return 'empty'; if(String(l.member_id)===String(member.id))return 'mine'; return 'taken'; }
  function pick(l){ const s=st(l); if(s==='taken'||s==='broken')return; setErr('');
    if(sel&&sel.id===l.id){setSel(null);return;}
    setSel(l); if(s==='mine'){ setSd(l.start_date||''); setEd(l.end_date||''); setUnlimited(!!l.unlimited); setPw(l.password||''); }
    else { setSd(ymd(new Date())); setEd(''); setUnlimited(false); setPw(''); } }
  async function assign(){
    if(!sel) return;
    if(!unlimited && !ed) return setErr('만료일을 입력하거나 무제한을 체크하세요');
    setBusy(true);
    const {error}=await sb.from('lockers').update({member_id:member.id,status:'활성',start_date:sd||null,end_date:unlimited?null:(ed||null),unlimited,password:pw||null}).eq('id',sel.id);
    setBusy(false);
    if(error) return setErr('저장 실패: '+error.message);
    logAct(sb,'락커 배정',`${member.name} · ${sel.number}번`);
    onSaved();
  }
  async function release(){
    if(!confirm(sel.number+'번 락커를 회수할까요?')) return;
    await sb.from('lockers').update({member_id:null,status:'미배정',start_date:null,end_date:null,unlimited:false,password:null,memo:null}).eq('id',sel.id);
    logAct(sb,'락커 회수',`${member.name} · ${sel.number}번`);
    onSaved();
  }
  const selSt = sel? st(sel):null;
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" style={{maxWidth:560}} onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>락커 지정 · {member.name}</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      {lockers===null? <div className="muted">불러오는 중...</div> :
       lockers.length===0? <div className="muted" style={{padding:'20px 0'}}>등록된 락커가 없습니다. 락커 탭에서 먼저 락커를 추가하세요.</div> : (<>
        <div className="lk-legend">
          <span><i style={{background:'var(--brass)'}}/>본인 사용중</span>
          <span><i style={{background:'#3a4b44'}}/>사용중</span>
          <span><i style={{background:'#d9a44f'}}/>고장</span>
          <span><i style={{border:'1px solid var(--line)',background:'var(--forest)'}}/>비어있음</span>
        </div>
        <div className="lkpick-grid">
          {lockers.map(l=>{ const s=st(l);
            return <button key={l.id} className={'lkpick '+s+(sel&&sel.id===l.id?' sel':'')} onClick={()=>pick(l)}
              title={s==='taken'? nameById[l.member_id]||'사용중' : s==='broken'?'고장':''}>
              {l.number}{s==='taken'&&<small>{nameById[l.member_id]||'사용중'}</small>}{s==='mine'&&<small>본인</small>}{s==='broken'&&<small>고장</small>}
            </button>; })}
        </div>
        {sel && selSt==='empty' && (<>
          <div style={{display:'flex',gap:8}}>
            <div className="field" style={{flex:1}}><label>시작일</label><input type="date" value={sd} onChange={e=>setSd(e.target.value)}/></div>
            <div className="field" style={{flex:1}}><label>만료일</label><input type="date" value={ed} disabled={unlimited} onChange={e=>setEd(e.target.value)}/></div>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:14,margin:'2px 0 10px',cursor:'pointer'}}><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)}/> 무제한 사용</label>
          <div className="field"><label>비밀번호 (선택)</label><input value={pw} onChange={e=>setPw(e.target.value)} placeholder="예: 1234"/></div>
          {err && <div className="err">{err}</div>}
          <button className="btn" style={{width:'100%'}} disabled={busy} onClick={assign}>{busy?'저장 중...':sel.number+'번 배정'}</button>
        </>)}
        {sel && selSt==='mine' && (<>
          <div style={{display:'flex',gap:8}}>
            <div className="field" style={{flex:1}}><label>시작일</label><input type="date" value={sd||''} onChange={e=>setSd(e.target.value)}/></div>
            <div className="field" style={{flex:1}}><label>만료일</label><input type="date" value={ed||''} disabled={unlimited} onChange={e=>setEd(e.target.value)}/></div>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:14,margin:'2px 0 10px',cursor:'pointer'}}><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)}/> 무제한 사용</label>
          <div className="field"><label>비밀번호</label><input value={pw} onChange={e=>setPw(e.target.value)} placeholder="예: 1234"/></div>
          {err && <div className="err">{err}</div>}
          <div style={{display:'flex',gap:8}}>
            <button className="btn" style={{flex:1}} disabled={busy} onClick={assign}>수정 저장</button>
            <button className="btn ghost danger" style={{flex:1}} onClick={release}>{sel.number}번 회수</button>
          </div>
        </>)}
        {!sel && <div className="muted" style={{fontSize:13}}>번호를 선택하세요. 브라스색은 이 회원이 사용 중인 락커입니다.</div>}
      </>)}
    </div></div>
  );
}

// ---------- 예약 내역 전체보기 (큰 팝업) ----------
function LessonHistoryModal({member,lessons,memberships,initialTab,onClose}){
  useEsc(onClose);
  const [tab,setTab]=useState(initialTab||'upcoming');
  const [msFilter,setMsFilter]=useState('all');
  const all=lessons||[], mss=memberships||[];
  const cnt=id=>all.filter(l=>String(l.membership_id)===String(id)).length;
  const noneCnt=all.filter(l=>!l.membership_id).length;
  const msName=id=>{ const m=mss.find(x=>String(x.id)===String(id)); return m? m.product_name : null; };
  const base = msFilter==='all'? all : msFilter==='none'? all.filter(l=>!l.membership_id) : all.filter(l=>String(l.membership_id)===msFilter);
  const nowISO=new Date().toISOString();
  const upcoming=base.filter(l=>l.status==='예약'&&l.start_at>=nowISO).slice().sort((a,b)=>a.start_at<b.start_at?-1:1);
  const past=base.filter(l=>!(l.status==='예약'&&l.start_at>=nowISO));
  const list = tab==='upcoming'? upcoming : past;
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" style={{maxWidth:680}} onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>예약 내역 · {member.name} <span className="muted" style={{fontWeight:400,fontSize:14}}>(총 {all.length}건)</span></h3><button className="xbtn" onClick={onClose}>✕</button></div>
      {mss.length>0 && (
        <div className="field" style={{marginBottom:12}}>
          <label>회원권 필터</label>
          <select value={msFilter} onChange={e=>{setMsFilter(e.target.value);}}>
            <option value="all">전체 회원권 ({all.length}건)</option>
            {mss.map(m=><option key={m.id} value={String(m.id)}>{m.product_name}{m.trainer?' · '+m.trainer:''} · {cnt(m.id)}건</option>)}
            {noneCnt>0 && <option value="none">회원권 미지정 · {noneCnt}건</option>}
          </select>
        </div>
      )}
      <div className="seg" style={{marginBottom:14}}>
        <button className={tab==='upcoming'?'on':''} onClick={()=>setTab('upcoming')}>예정 {upcoming.length}</button>
        <button className={tab==='past'?'on':''} onClick={()=>setTab('past')}>지난 {past.length}</button>
      </div>
      <div style={{maxHeight:'62vh',overflowY:'auto'}}>
        {list.length===0? <div className="muted" style={{padding:'20px 0',textAlign:'center'}}>{tab==='upcoming'?'예정된 예약이 없습니다':'지난 수업 기록이 없습니다'}</div> :
          list.map(l=>(<div className="card" key={l.id} style={{padding:'10px 14px'}}>
            <div className="kv"><b>{l.lesson_name||'수업'} <span className={'mini '+l.status}>{l.status}</span></b><span>{fmtDT(l.start_at)}</span></div>
            <div className="kv"><span>{l.trainer||'-'}{msName(l.membership_id)?<span className="muted"> · {msName(l.membership_id)}</span>:(!l.membership_id?<span className="muted"> · 회원권 미지정</span>:'')}</span><span>{l.noshow_reason?('노쇼: '+l.noshow_reason):(l.price?l.price.toLocaleString()+'원':'')}</span></div>
          </div>))}
      </div>
    </div></div>
  );
}

// ---------- 회원 목록 ----------
function MembersView({sb}){
  const {can}=usePerm();
  const [rows,setRows]=useState(null);
  const [q,setQ]=useState(''),[query,setQuery]=useState(''),[tab,setTab]=useState('전체');
  function doSearch(v){ setQuery((v??q).trim()); }
  const [sel,setSel]=useState(null);
  const [adding,setAdding]=useState(false);
  const [sort,setSort]=useState('name');
  const [tagF,setTagF]=useState('');
  const [checked,setChecked]=useState(()=>new Set());
  const [msAll,setMsAll]=useState([]);
  async function load(){
    const {data,error}=await fetchAll(()=>sb.from('members').select('*').order('name').order('id')); if(!error) setRows(data);
    const m=await fetchAll(()=>sb.from('memberships').select('member_id,status,end_date').order('id')); setMsAll(m.data||[]);
  }
  useEffect(()=>{ load(); },[]);
  // 회원별 임박(활성 회원권 D-14 이내) / 홀딩(홀딩 회원권 보유) 플래그
  const msFlags=useMemo(()=>{ const t=new Date(); const t0=new Date(t.getFullYear(),t.getMonth(),t.getDate()); const f={};
    msAll.forEach(m=>{ const o=f[m.member_id]=f[m.member_id]||{soon:false,hold:false};
      if(m.status==='홀딩') o.hold=true;
      else if(m.status==='활성'&&m.end_date){ const d=new Date(m.end_date); if(!isNaN(d)){ const dd=Math.ceil((new Date(d.getFullYear(),d.getMonth(),d.getDate())-t0)/86400000); if(dd>=0&&dd<=14) o.soon=true; } } });
    return f; },[msAll]);
  // 임박/홀딩은 회원권 플래그 OR (브로제이 이전분) 회원 status 값으로 판정 — 이중집계 방지
  const isSoon=r=>((msFlags[r.id]&&msFlags[r.id].soon)||r.status==='임박');
  const isHold=r=>((msFlags[r.id]&&msFlags[r.id].hold)||r.status==='홀딩');
  const counts = useMemo(()=>{ const c={전체:rows?rows.length:0,활성:0,임박:0,홀딩:0,만료:0,미등록:0,동의미확보:0};
    (rows||[]).forEach(r=>{ if(['활성','만료','미등록'].includes(r.status))c[r.status]++; if(isSoon(r))c.임박++; if(isHold(r))c.홀딩++; if(!r.consent_at)c.동의미확보++; }); return c; },[rows,msFlags]);
  const allTags=useMemo(()=>{ const s=new Set();
    (rows||[]).forEach(r=>(r.tags||'').split(',').forEach(t=>{ t=t.trim(); if(t) s.add(t); }));
    return [...s].sort((a,b)=>a.localeCompare(b,'ko')); },[rows]);
  const filtered = (rows||[]).filter(r=>{
    if(tab==='임박'){ if(!isSoon(r)) return false; }
    else if(tab==='홀딩'){ if(!isHold(r)) return false; }
    else if(tab==='동의미확보'){ if(r.consent_at) return false; }
    else if(tab!=='전체' && r.status!==tab) return false;
    if(tagF && !(r.tags||'').split(',').map(s=>s.trim()).includes(tagF)) return false;
    if(query){ const nq=query.trim(); const d=query.replace(/\D/g,''); return (r.name||'').includes(nq)||(d&&(r.phone||'').replace(/\D/g,'').includes(d)); }
    return true;
  });
  const sorted=[...filtered].sort((a,b)=>{
    if(sort==='new') return (b.reg_date||'').localeCompare(a.reg_date||'');
    if(sort==='old') return (a.reg_date||'').localeCompare(b.reg_date||'');
    return (a.name||'').localeCompare(b.name||'','ko');
  });
  const shown = sorted.slice(0,300);
  function exportMembers(){
    const rows=[['번호','상태','고객명','성별','나이','생년월일','연락처','주소','등록일','상담담당','태그','메모']];
    sorted.forEach((r,i)=>rows.push([i+1,r.status||'',r.name||'',r.gender||'',age(r.birth)||'',r.birth||'',r.phone||'',r.address||'',fmtDate(r.reg_date),r.manager||'',r.tags||'',r.memo||'']));
    downloadCSV('회원목록.csv',rows);
  }
  function toggle(id){ setChecked(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; }); }
  function toggleAll(){ setChecked(p=> p.size===shown.length? new Set() : new Set(shown.map(r=>r.id)) ); }
  async function delChecked(){
    const ids=[...checked];
    const names=(rows||[]).filter(r=>checked.has(r.id)).map(r=>r.name).slice(0,5).join(', ');
    if(!confirm(`${ids.length}명(${names}${ids.length>5?' 외':''})을 삭제할까요?\n\n· 보유 회원권도 함께 삭제됩니다\n· 수업/결제 기록은 남지만 회원 연결이 해제됩니다\n· 배정된 락커는 자동 회수됩니다\n\n이 작업은 되돌릴 수 없습니다.`)) return;
    await sb.from('lockers').update({member_id:null,status:'미배정',start_date:null,end_date:null,unlimited:false,password:null,memo:null}).in('member_id',ids);
    await maybeBeforeDeleteSnapshot(sb);
    const {error}=await sb.from('members').delete().in('id',ids);
    if(error) return alert('삭제 실패: '+error.message);
    logAct(sb,'회원 삭제',`${ids.length}명: ${names}${ids.length>5?' 외':''}`);
    setChecked(new Set()); load();
  }
  return (<>
    <div className="stats">
      <div className="stat"><div className="n">{counts.전체}</div><div className="l">전체 회원</div></div>
      <div className="stat"><div className="n" style={{color:'#7dc4a0'}}>{counts.활성}</div><div className="l">활성</div></div>
      <div className="stat"><div className="n" style={{color:'#d98b7a'}}>{counts.만료}</div><div className="l">만료</div></div>
      <div className="stat"><div className="n muted">{counts.미등록}</div><div className="l">미등록</div></div>
    </div>
    <div className="bar">
      <div className="tabs">
        {['전체','활성','임박','홀딩','만료','미등록','동의미확보'].map(t=>(
          <button key={t} className={'tab'+(tab===t?' on':'')} onClick={()=>setTab(t)}>{t==='동의미확보'?'동의 미확보':t} {counts[t]!==undefined?counts[t]:''}</button>
        ))}
      </div>
      <div className="searchbox">
        <input className="search" placeholder="이름 또는 전화번호 검색" value={q}
          onChange={e=>{ const v=e.target.value; setQ(v); if(v==='') setQuery(''); }}
          onKeyDown={e=>{ if(e.key==='Enter') doSearch(); }}/>
        {q && <button className="btn ghost sm" title="지우기" onClick={()=>{ setQ(''); setQuery(''); }}>✕</button>}
        <button className="btn sm" onClick={()=>doSearch()}>🔍 검색</button>
      </div>
      {query && <span className="muted" style={{fontSize:13}}>'{query}' 검색 {filtered.length}명</span>}
      {allTags.length>0 && <select value={tagF} onChange={e=>setTagF(e.target.value)} style={{background:'var(--forest2)',border:'1px solid '+(tagF?'var(--brass)':'var(--line)'),borderRadius:10,padding:'9px 12px',color:tagF?'var(--brass)':'var(--cream)',fontSize:14,cursor:'pointer'}}>
        <option value="">🏷 태그 전체</option>
        {allTags.map(t=><option key={t} value={t}>{t}</option>)}
      </select>}
      <select value={sort} onChange={e=>setSort(e.target.value)} style={{background:'var(--forest2)',border:'1px solid var(--line)',borderRadius:10,padding:'9px 12px',color:'var(--cream)',fontSize:14,cursor:'pointer'}}>
        <option value="name">이름순</option><option value="new">최근 등록순</option><option value="old">오래된 등록순</option>
      </select>
      <button className="btn ghost sm" onClick={exportMembers}>⤓ 엑셀</button>
      <button className="btn" onClick={()=>setAdding(true)}>＋ 회원 추가</button>
    </div>
    {checked.size>0 && can('delete_members') && <div className="selbar">
      <span className="cnt">{checked.size}명 선택됨</span>
      <button className="btn danger sm" onClick={delChecked}>삭제</button>
      <button className="xbtn" onClick={()=>setChecked(new Set())} title="선택 해제">✕</button>
    </div>}
    {rows===null? <div className="empty">회원 불러오는 중...</div> :
    <div className="list mlist-table" style={{marginBottom:40}}>
      <div className="row head">
        <div><input type="checkbox" checked={shown.length>0&&checked.size===shown.length} onChange={toggleAll}/></div>
        <div>번호</div><div>상태</div><div>고객명</div><div>성별</div><div>나이</div><div>연락처</div>
      </div>
      {shown.length===0? <div className="empty">검색 결과가 없습니다.</div> :
        shown.map((r,i)=>(
          <div className="row" key={r.id} onClick={()=>setSel(r)}>
            <div onClick={e=>e.stopPropagation()}><input type="checkbox" checked={checked.has(r.id)} onChange={()=>toggle(r.id)}/></div>
            <div className="muted">{i+1}</div>
            <div><span className={'badge b-'+(r.status||'')}>{r.status||'-'}</span></div>
            <div className="name">{r.name}</div>
            <div className="muted">{r.gender||'-'}</div>
            <div className="muted">{age(r.birth)||'-'}</div>
            <div className="phone">{r.phone||'-'}</div>
          </div>))}
      {filtered.length>300 && <div className="empty">상위 300명만 표시 중 (검색으로 좁혀보세요) · 전체 {filtered.length}명</div>}
    </div>}
    {sel && <Detail sb={sb} member={sel} onClose={()=>{setSel(null);load();}}/>}
    {adding && <AddMemberModal sb={sb} onClose={()=>setAdding(false)} onSaved={(m)=>{setAdding(false);load();setSel(m);}}/>}
  </>);
}

// ---------- 신규 회원 등록 ----------
function AddMemberModal({sb,onClose,onSaved,initName}){
  useEsc(onClose);
  const {role,name:myName}=usePerm();
  const [name,setName]=useState(initName||'');  // 스케줄 가져오기에서 '회원없음'을 바로 풀 때 이름을 채워준다
  const [phone,setPhone]=useState('');
  const [gender,setGender]=useState('');
  const [birth,setBirth]=useState('');
  const [address,setAddress]=useState('');
  const [manager,setManager]=useState('');
  const [memo,setMemo]=useState('');
  const [consentPriv,setConsentPriv]=useState(false),[consentMkt,setConsentMkt]=useState(false);
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function save(){
    if(!name.trim()) return setErr('이름을 입력하세요');
    setBusy(true); setErr('');
    // 중복 회원 방지: 같은 전화번호가 이미 있으면 경고(그래도 등록할지 확인)
    const pd=phoneDigits(phone);
    if(pd.length>=8){
      // limit(2000)이면 회원이 그 이상 늘었을 때 중복을 조용히 놓친다 → 끝까지 훑는다
      const {data:dups}=await fetchAll(()=>sb.from('members').select('id,name,phone').order('id'));
      const hit=(dups||[]).find(m=>phoneDigits(m.phone)===pd);
      if(hit && !confirm(`이미 '${hit.name}' 회원이 이 번호(${hit.phone||''})로 등록되어 있습니다.\n\n동명이인이 아니라면 중복일 수 있어요.\n그래도 새로 등록할까요?`)){ setBusy(false); return; }
    }
    const {data,error}=await sb.from('members').insert({
      name:name.trim(), phone:phone.trim()||null, gender:gender||null, birth:birth||null,
      address:address.trim()||null, manager:manager.trim()||null, memo:memo.trim()||null,
      status:'미등록', reg_date:ymd(new Date()),
      assigned_trainer: role==='master'? null : (myName||null),  // 프리랜서가 추가 시 자기 담당(RLS 유지)
      consent_at: consentPriv? new Date().toISOString() : null, consent_marketing: consentMkt
    }).select().single();
    setBusy(false);
    if(error){ setErr('저장 실패: '+error.message); return; }
    logAct(sb,'회원 등록',name.trim());
    onSaved(data);
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>신규 회원 등록</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>이름 *</label><input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="회원 이름"/></div>
        <div className="field" style={{width:110}}><label>성별</label>
          <select value={gender} onChange={e=>setGender(e.target.value)}><option value="">-</option><option>남성</option><option>여성</option></select></div>
      </div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>전화번호</label><input value={phone} onChange={e=>setPhone(fmtPhone(e.target.value))} placeholder="010-0000-0000" inputMode="numeric"/></div>
        <div className="field" style={{flex:1}}><label>생년월일</label><input type="date" value={birth} onChange={e=>setBirth(e.target.value)}/></div>
      </div>
      <div className="field"><label>주소</label><input value={address} onChange={e=>setAddress(e.target.value)} placeholder="주소"/></div>
      <div className="field"><label>상담 담당</label><input value={manager} onChange={e=>setManager(e.target.value)} placeholder="담당자 이름"/></div>
      <div className="field"><label>메모</label><input value={memo} onChange={e=>setMemo(e.target.value)} placeholder="특이사항"/></div>
      <div className="field"><label>개인정보 동의</label>
        <label className="chk"><input type="checkbox" checked={consentPriv} onChange={e=>setConsentPriv(e.target.checked)}/> 개인정보 수집·이용 동의 (필수)</label>
        <label className="chk" style={{marginTop:4}}><input type="checkbox" checked={consentMkt} onChange={e=>setConsentMkt(e.target.checked)}/> 마케팅 정보 수신 동의 (선택)</label>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn" style={{width:'100%'}} disabled={busy} onClick={save}>{busy?'등록 중...':'회원 등록'}</button>
      <p className="muted" style={{fontSize:12,marginTop:8,marginBottom:0}}>등록 후 회원 상세에서 ＋레슨 등록으로 회원권을 추가하면 '활성'으로 전환됩니다.</p>
    </div></div>
  );
}

// ---------- 예약 모달 ----------
function BookingModal({sb,date,members,trainers,onClose,onSaved}){
  useEsc(onClose);
  const [dt,setDt]=useState(date); // 예약 날짜 (모달 내 변경 가능)
  const [mode,setMode]=useState('member'); // member | guest
  const [q,setQ]=useState(''),[sel,setSel]=useState(null);
  const [start,setStart]=useState('10:00'),[dur,setDur]=useState('50'),[trainer,setTrainer]=useState('');
  const [name,setName]=useState('1:1 PT'),[guestName,setGuestName]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const [mss,setMss]=useState([]),[msId,setMsId]=useState(null);
  const selectedMs=msId?mss.find(x=>String(x.id)===String(msId)):null;
  const assignedTrainer=selectedMs?String(selectedMs.trainer||'').trim():'';
  const cands = q? members.filter(m=>{ const digits=q.replace(/\D/g,'');
    return (m.name||'').includes(q) || (digits && (m.phone||'').replace(/\D/g,'').includes(digits)); }).slice(0,8):[];
  async function selectMember(m){
    setSel(m);
    const {data}=await sb.from('memberships').select('*').eq('member_id',m.id).eq('status','활성').gt('remaining_count',0).order('end_date',{nullsFirst:false});
    const list=data||[];
    setMss(list); setMsId(list[0]? list[0].id : null);
    setTrainer(list[0]?String(list[0].trainer||'').trim():'');
  }
  function times(){ const startISO=new Date(`${dt}T${start}:00+09:00`); const endISO=new Date(startISO.getTime()+(parseInt(dur)||50)*60000); return [startISO.toISOString(), endISO.toISOString()]; }
  async function conflictOK(s,e){
    if(!trainer) return true;
    const d0=new Date(`${dt}T00:00:00+09:00`).toISOString(), d1=new Date(`${dt}T23:59:59+09:00`).toISOString();
    const {data}=await sb.from('lessons').select('start_at,end_at,lesson_name,member_id').eq('trainer',trainer).eq('status','예약').gte('start_at',d0).lte('start_at',d1);
    const c=(data||[]).find(l=> l.start_at < e && (l.end_at||l.start_at) > s);
    if(c) return confirm(`⚠️ ${trainer} 강사가 ${hm(c.start_at)}에 이미 예약이 있습니다 (${c.lesson_name}).\n그래도 예약을 진행할까요?`);
    return true;
  }
  const [repeat,setRepeat]=useState('1'); // 매주 같은 요일/시간 반복 횟수
  function nthDate(i){ const d=new Date(`${dt}T00:00:00+09:00`); d.setDate(d.getDate()+7*i); return ymd(d); }
  async function saveMember(){
    if(!sel) return setErr('회원을 선택하세요');
    const n=Math.max(1,Math.min(20,parseInt(repeat)||1));
    setErr('');
    const picked=msId?mss.find(x=>String(x.id)===String(msId)):null;
    if(!picked) return setErr('차감할 회원권을 선택하세요. 회원권이 없으면 회원 상세에서 레슨/회원권을 먼저 등록해주세요.');
    const fixedTrainer=String(picked.trainer||'').trim();
    if(!fixedTrainer) return setErr('선택한 회원권에 담당 강사가 없습니다. 회원권 수정에서 담당 강사를 먼저 지정하세요.');
    setTrainer(fixedTrainer);
    // 잔여횟수 검증: 반복 수가 잔여보다 많으면 차단
    if(n>(picked.remaining_count||0)) return setErr(`잔여 ${picked.remaining_count}회인데 ${n}회를 예약하려고 합니다. 반복 횟수를 줄여주세요.`);
    setBusy(true);
    // 전체 기간 충돌 일괄 확인 (강사 지정 시)
    if(fixedTrainer){
      const d0=new Date(`${dt}T00:00:00+09:00`).toISOString();
      const dEnd=new Date(`${nthDate(n-1)}T23:59:59+09:00`).toISOString();
      const {data:exist}=await sb.from('lessons').select('start_at,end_at,lesson_name').eq('trainer',fixedTrainer).eq('status','예약').gte('start_at',d0).lte('start_at',dEnd);
      const clashes=[];
      for(let i=0;i<n;i++){ const di=nthDate(i); const s=new Date(`${di}T${start}:00+09:00`).toISOString(); const e=new Date(new Date(s).getTime()+(parseInt(dur)||50)*60000).toISOString();
        const c=(exist||[]).find(l=> l.start_at<e && (l.end_at||l.start_at)>s); if(c) clashes.push(`${di} ${hm(c.start_at)} (${c.lesson_name})`); }
      if(clashes.length && !confirm(`⚠️ ${fixedTrainer} 강사 기존 예약과 겹칩니다:\n${clashes.join('\n')}\n\n그래도 전부 예약할까요?`)){ setBusy(false); return; }
    }
    // ★같은 회원·같은 시작시간 중복 방지.
    //   주간 가져오기에는 있던 가드가 수동 예약에는 없었다(2026-08-01 발견).
    //   가져오기에서 실패한 건을 손으로 다시 넣는 흐름에서 밟기 쉬운데,
    //   중복 등록하면 예약이 2건 생기고 회차도 2번 깎인다.
    {
      const d0=new Date(`${dt}T00:00:00+09:00`).toISOString();
      const dEnd=new Date(`${nthDate(n-1)}T23:59:59+09:00`).toISOString();
      const {data:mine}=await sb.from('lessons').select('start_at,lesson_name,status')
        .eq('member_id',sel.id).neq('status','취소').gte('start_at',d0).lte('start_at',dEnd);
      const dups=[];
      for(let i=0;i<n;i++){ const di=nthDate(i); const ts=new Date(`${di}T${start}:00+09:00`).getTime();
        const hit=(mine||[]).find(l=>Math.abs(new Date(l.start_at).getTime()-ts)<60000);
        if(hit) dups.push(`${di} ${start} (${hit.lesson_name||'수업'} · ${hit.status})`); }
      if(dups.length){ setBusy(false);
        return setErr(`이미 같은 시간에 ${sel.name} 회원의 수업이 있습니다:\n${dups.join('\n')}\n\n중복 등록하면 회차가 두 번 차감됩니다. 시간을 바꾸거나 기존 예약을 확인해주세요.`); }
    }
    // 일괄 삽입
    const rows=[]; for(let i=0;i<n;i++){ const di=nthDate(i); const s=new Date(`${di}T${start}:00+09:00`).toISOString(); const e=new Date(new Date(s).getTime()+(parseInt(dur)||50)*60000).toISOString();
      rows.push({member_id:sel.id, membership_id:msId, start_at:s, end_at:e, lesson_name:name, trainer:fixedTrainer, status:'예약'}); }
    const {error}=await sb.from('lessons').insert(rows);
    if(error){ setBusy(false); return setErr('저장 실패: '+error.message); }
    // ★차감 실패를 삼키면 "예약은 있는데 회차는 안 깎인" 상태가 소리 없이 생긴다.
    //   예약 저장은 이미 끝났으므로 되돌리지 않고, 몇 건이 실패했는지 반드시 알린다.
    //   (2026-07 이중차감의 거울상 — 그때는 두 번 깎였고 이건 안 깎이는 쪽이다)
    let deducted=0, cFail='';
    if(msId){
      for(let i=0;i<n;i++){
        const {error:cErr}=await sb.rpc('consume_specific',{p_membership_id:msId});
        if(cErr){ cFail=cErr.message; break; }
        deducted++;
      }
    }
    logAct(sb,'수업 예약',`${sel.name} · ${name} · ${dt} ${start}${n>1?` (매주 ×${n}회, ~${nthDate(n-1)})`:''}${msId&&deducted<n?` ⚠차감 ${deducted}/${n}`:''}`);
    setBusy(false);
    if(msId && deducted<n){
      alert(`⚠️ 예약 ${n}건은 저장됐지만 회차 차감이 ${n-deducted}건 실패했습니다.${cFail?`\n(${cFail})`:''}\n\n잔여 회차가 실제보다 많게 표시됩니다.\n회원 상세 → 회원권 수정에서 잔여 회차를 직접 맞춰주세요.`);
    }
    onSaved();
  }
  async function saveGuest(){
    setBusy(true); const [s,e]=times();
    if(!await conflictOK(s,e)){ setBusy(false); return; }
    const ln = guestName.trim()? `${name} - ${guestName.trim()}` : name;
    const {error}=await sb.from('lessons').insert({member_id:null, membership_id:null, start_at:s, end_at:e, lesson_name:ln, trainer:trainer||null, status:'예약'});
    setBusy(false); if(error){ setErr('저장 실패: '+error.message); return; }
    logAct(sb,'수업 예약(비회원)',`${ln} · ${dt} ${start}`);
    onSaved();
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>수업 예약 · {dt}</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <div className="field"><label>날짜</label><input type="date" value={dt} onChange={e=>setDt(e.target.value||dt)}/></div>
      <div className="seg" style={{marginBottom:12}}>
        <button type="button" className={mode==='member'?'on':''} onClick={()=>setMode('member')}>회원 수업</button>
        <button type="button" className={mode==='guest'?'on':''} onClick={()=>setMode('guest')}>비회원 (OT·상담)</button>
      </div>
      {mode==='member'? (!sel? <>
        <div className="field"><label>회원 검색</label>
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="이름 또는 전화"/></div>
        {cands.length>0 && <div className="mlist">{cands.map(m=>(
          <button key={m.id} onClick={()=>selectMember(m)}>{m.name} <span className="muted">{m.phone||''}</span></button>))}</div>}
      </> : <>
        <div className="field"><label>회원</label>
          <div className="card" style={{margin:0,display:'flex',justifyContent:'space-between'}}><b>{sel.name}</b>
            <button className="link" style={{margin:0}} onClick={()=>setSel(null)}>변경</button></div></div>
        <div className="field"><label>차감할 회원권 <span className="muted">(예약 시 1회 즉시 차감)</span></label>
          {mss.length===0? <div className="muted" style={{fontSize:13}}>활성 회원권이 없습니다. 회원 상세에서 레슨/회원권을 먼저 등록하세요.</div> :
            <>
              <select value={msId||''} onChange={e=>{ const id=e.target.value?parseInt(e.target.value):null; const m=mss.find(x=>String(x.id)===String(id)); setMsId(id); setTrainer(m?String(m.trainer||'').trim():''); }}>
                {mss.map(m=><option key={m.id} value={m.id}>{m.product_name} · 담당 {m.trainer||'미지정'} · 잔여 {m.remaining_count}/{m.total_count}</option>)}
              </select>
              <div className="muted" style={{fontSize:12,marginTop:5}}>선택한 회원권의 담당강사만 예약할 수 있습니다.</div>
            </>}</div>
        <div className="field"><label>수업명</label>
          <div className="seg">{['1:1 PT','OT','상담'].map(t=>(
            <button key={t} type="button" className={name===t?'on':''} onClick={()=>setName(t)}>{t}</button>))}</div></div>
        <div className="row2">
          <div className="field" style={{flex:1}}><label>시작 시간</label><input type="time" value={start} onChange={e=>setStart(e.target.value)}/></div>
          <div className="field" style={{width:100}}><label>길이(분)</label><input type="number" value={dur} onChange={e=>setDur(e.target.value)}/></div>
        </div>
        <div className="row2">
          <div className="field" style={{flex:1}}><label>담당 강사</label>
            <div className="card" style={{margin:0,padding:'9px 11px',fontWeight:700,color:assignedTrainer?'var(--cream)':'#d98b7a'}}>{assignedTrainer||'담당 강사 미지정'}</div></div>
          <div className="field" style={{width:130}}><label>반복(매주)</label>
            <select value={repeat} onChange={e=>setRepeat(e.target.value)}>
              {Array.from({length:20},(_,i)=>i+1).map(n=><option key={n} value={n}>{n===1?'1회 (반복없음)':`매주 ×${n}회`}</option>)}
            </select></div>
        </div>
        {parseInt(repeat)>1 && <p className="muted" style={{fontSize:12,margin:'-4px 0 10px'}}>{dt}부터 매주 같은 요일 {start}에 {repeat}회 예약됩니다 (마지막 {nthDate(parseInt(repeat)-1)}){msId?' · 잔여횟수도 '+repeat+'회 차감':''}.</p>}
        <button className="btn" disabled={busy||!selectedMs||!assignedTrainer} onClick={saveMember}>{busy?'저장 중...':parseInt(repeat)>1?`${repeat}회 일괄 예약`:'예약 저장'}</button>
      </>) : <>
        <div className="field"><label>수업 종류</label>
          <div className="seg">{['OT','상담','기타'].map(t=>(
            <button key={t} type="button" className={name===t?'on':''} onClick={()=>setName(t)}>{t}</button>))}</div></div>
        <div className="field"><label>이름 / 메모 <span className="muted">(선택)</span></label>
          <input value={guestName} onChange={e=>setGuestName(e.target.value)} placeholder="예: 홍길동 (신규문의)"/></div>
        <div className="row2">
          <div className="field" style={{flex:1}}><label>시작 시간</label><input type="time" value={start} onChange={e=>setStart(e.target.value)}/></div>
          <div className="field" style={{width:100}}><label>길이(분)</label><input type="number" value={dur} onChange={e=>setDur(e.target.value)}/></div>
        </div>
        <div className="field"><label>강사</label>
          <input list="trainers" value={trainer} onChange={e=>setTrainer(e.target.value)} placeholder="강사명"/>
          <datalist id="trainers">{trainers.map(t=><option key={t} value={t}/>)}</datalist></div>
        <button className="btn" disabled={busy} onClick={saveGuest}>{busy?'저장 중...':'비회원 일정 저장'}</button>
      </>}
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 주간스케줄 관리도구 → CRM 직접 연동 (2026-08-01) ----------
// 관리도구(github.io/gymlord-weekly-scheduler)와 CRM(github.io/gymlord-crm)은
// **같은 오리진**이라 localStorage를 공유한다. 관리도구가 확정 일정을 여기 넣고
// CRM을 `?import=1`로 열면, 캘린더가 '주간 스케줄 가져오기'를 그 일정으로 채운 채 자동으로 연다.
//   → 복사 → 앱 전환 → 붙여넣기 3단계가 사라진다. 실사용의 54%가 이 작업이었다.
// ★회원매칭·중복·시간겹침 검사는 기존 CRM 로직을 그대로 탄다. 자동으로 밀어넣지 않는 이유는
//   동명이인·회원권없음은 사람이 판단해야 하는 항목이라 화면에서 풀어야 하기 때문이다.
const HANDOFF_KEY='gl_schedule_handoff';
const HANDOFF_TTL=30*60000;   // 30분 지난 전달분은 무시 — 지난 주차를 잘못 등록하는 사고 방지
function takeScheduleHandoff(){
  try{
    const raw=localStorage.getItem(HANDOFF_KEY);
    if(!raw) return null;
    localStorage.removeItem(HANDOFF_KEY);   // 1회용: 새로고침해도 다시 뜨지 않는다
    const h=JSON.parse(raw);
    if(!h || !h.payload) return null;
    if(Date.now()-(h.at||0) > HANDOFF_TTL) return null;
    return h;
  }catch(e){ return null; }
}

// ---------- 주간 스케줄 일괄 가져오기 ----------
// 직전 설정 기억 — 매주 같은 값(강사·수업명·길이)을 다시 고르던 것을 없앤다.
const IMPORT_PREFS='gl_import_prefs';
const BAD_LABEL={missing_member:'회원없음',ambiguous_member:'동명이인',no_membership:'회원권없음',
  trainer_mismatch:'강사불일치',conflict:'시간겹침',invalid:'형식오류',error:'오류'};
function loadImportPrefs(){ try{ return JSON.parse(localStorage.getItem(IMPORT_PREFS))||{}; }catch(e){ return {}; } }

function ScheduleImportModal({sb,members,trainers,handoff,onClose,onSaved}){
  useEsc(onClose);
  const pref=useMemo(()=>loadImportPrefs(),[]);
  // 관리도구에서 넘어온 일정이 있으면 처음부터 채워둔다 → 아래 자동검사 effect가 바로 검사한다
  const [text,setText]=useState(()=> handoff && handoff.payload ? JSON.stringify(handoff.payload,null,2) : '');
  const [items,setItems]=useState([]);
  const [err,setErr]=useState('');
  const [busy,setBusy]=useState(false);
  const [trainer,setTrainer]=useState(pref.trainer||'서민기');
  const [lessonName,setLessonName]=useState(pref.lessonName||'대표 PT');
  const [duration,setDuration]=useState(pref.duration||'60');
  const [allowNoMembership,setAllowNoMembership]=useState(!!pref.allowNoMembership);
  const [skipConflicts,setSkipConflicts]=useState(pref.skipConflicts!==false);
  const [result,setResult]=useState(null);
  const [picks,setPicks]=useState({}); // 동명이인 수동 지정: {행idx: member_id}
  // ── 실패 건을 이 모달 안에서 바로 푼다 (예전엔 다른 화면에서 고치고 돌아와 재시도해야 했다) ──
  const [extra,setExtra]=useState([]);            // 여기서 새로 만든 회원
  const [addMember,setAddMember]=useState(null);  // {idx,name} 회원 등록 모달
  const [addMs,setAddMs]=useState(null);          // {member} 회원권 등록 모달
  const [rowTrainer,setRowTrainer]=useState({});  // {행idx: 강사명} 이 행만 강사 바꾸기
  const [onlyBad,setOnlyBad]=useState(false);
  const allMembers=useMemo(()=>[...members,...extra],[members,extra]);

  useEffect(()=>{ try{ localStorage.setItem(IMPORT_PREFS,
    JSON.stringify({trainer,lessonName,duration,skipConflicts,allowNoMembership})); }catch(e){} },
    [trainer,lessonName,duration,skipConflicts,allowNoMembership]);

  function statusBadge(status){
    const map={
      ready:['b-활성','등록가능'],
      registered:['b-활성','등록완료'],
      duplicate:['b-임박','중복'],
      conflict:['b-만료','시간겹침'],
      missing_member:['b-만료','회원없음'],
      ambiguous_member:['b-만료','동명이인'],
      no_membership:['b-임박','회원권없음'],
      trainer_mismatch:['b-만료','강사불일치'],
      invalid:['b-만료','형식오류'],
      error:['b-만료','오류']
    };
    const [cls,label]=map[status]||['b-만료',status||'확인'];
    return <span className={'badge '+cls}>{label}</span>;
  }

  function readPayload(){
    const raw=text.trim();
    if(!raw) throw new Error('스케줄러에서 복사한 JSON을 붙여넣어주세요.');
    try{ return JSON.parse(raw); }
    catch(e){}
    const objectStart=raw.indexOf('{'), objectEnd=raw.lastIndexOf('}');
    const arrayStart=raw.indexOf('['), arrayEnd=raw.lastIndexOf(']');
    if(objectStart>=0 && objectEnd>objectStart) return JSON.parse(raw.slice(objectStart,objectEnd+1));
    if(arrayStart>=0 && arrayEnd>arrayStart) return JSON.parse(raw.slice(arrayStart,arrayEnd+1));
    throw new Error('JSON 형식을 찾지 못했습니다.');
  }

  function payloadRows(payload){
    if(Array.isArray(payload)) return payload;
    if(payload && Array.isArray(payload.rows)) return payload.rows;
    if(payload && Array.isArray(payload.results)) return payload.results;
    if(payload && Array.isArray(payload.items)) return payload.items;
    return [];
  }

  function buildTime(date,start,end,durMin){
    const cleanStart=String(start||'').trim();
    const m=cleanStart.match(/^(\d{1,2}):(\d{2})$/);
    if(!date || !m) return null;
    const s=new Date(`${date}T${pad(m[1])}:${m[2]}:00+09:00`);
    if(isNaN(s)) return null;
    const cleanEnd=String(end||'').trim();
    const em=cleanEnd.match(/^(\d{1,2}):(\d{2})$/);
    const e=em ? new Date(`${date}T${pad(em[1])}:${em[2]}:00+09:00`) : new Date(s.getTime()+durMin*60000);
    if(isNaN(e) || e<=s) return null;
    return {start:s,end:e,startISO:s.toISOString(),endISO:e.toISOString()};
  }

  function compactName(v){ return String(v||'').replace(/\s+/g,'').trim(); }
  function findMember(name){
    const exact=allMembers.filter(m=>(m.name||'').trim()===name);
    if(exact.length===1) return {member:exact[0]};
    if(exact.length>1) return {status:'ambiguous_member',message:'같은 이름의 회원이 2명 이상입니다.',candidates:exact};
    const compact=allMembers.filter(m=>compactName(m.name)===compactName(name));
    if(compact.length===1) return {member:compact[0]};
    if(compact.length>1) return {status:'ambiguous_member',message:'비슷한 이름의 회원이 2명 이상입니다.',candidates:compact};
    return {status:'missing_member',message:'CRM 회원 목록에서 찾지 못했습니다.'};
  }

  function lessonCategory(name){
    return /대표/.test(name) ? '대표PT' : /1:1/.test(name) ? '1:1PT' : 'PT';
  }
  function normTrainer(v){ return String(v||'').trim(); }
  // ★수업명 칸에 회원 이름이 들어오는 오염을 걸러낸다.
  //   2026-08-01 실측: 7월 수업 283건 중 52건이 '주영님'·'희원님'·'구민주님'처럼
  //   수업명이 아니라 회원명이었다. 이러면 수업 종류별 통계가 아예 불가능해진다.
  //   ①회원명 그대로 ②'…님'만 붙은 것 ③이름 뒷부분만('김주영'→'주영님') → 기본 수업명으로 되돌린다.
  //   ④'대표 PT 이진영'처럼 뒤에 이름이 덧붙은 것은 이름만 떼어낸다.
  const dropHonor=s=>String(s||'').replace(/\s*(님|씨)\s*$/,'').trim();
  function cleanLessonName(raw,memberName,fallback){
    const s=String(raw||'').trim();
    if(!s) return fallback;
    const nm=String(memberName||'').trim();
    if(!nm) return s;
    const bare=dropHonor(s), nmBare=dropHonor(nm);
    if(bare===nm || bare===nmBare) return fallback;                       // ①②
    if(bare.length>=2 && nmBare.endsWith(bare)) return fallback;          // ③ 이름 뒷부분
    const esc=nm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');                   // ④ 꼬리 제거
    const cut=s.replace(new RegExp('\\s*'+esc+'\\s*(님|씨)?\\s*$'),'').trim();
    return (cut && cut!==s) ? cut : s;
  }

  async function buildItems(picksArg=picks){
    setErr('');
    setResult(null);
    let payload;
    try{ payload=readPayload(); }
    catch(e){ setErr(e.message); return []; }

    const rows=payloadRows(payload);
    if(!rows.length){ setErr('등록할 rows가 없습니다.'); return []; }

    const defaultTrainer=payload.trainer || trainer || '서민기';
    const defaultLesson=payload.lessonType || payload.lessonName || lessonName || '대표 PT';
    const defaultDuration=parseInt(payload.brojDurationMinutes || payload.durationMinutes || duration)||60;
    if(defaultTrainer!==trainer) setTrainer(defaultTrainer);
    if(defaultLesson!==lessonName) setLessonName(defaultLesson);
    if(String(defaultDuration)!==String(duration)) setDuration(String(defaultDuration));

    const prepared=rows.map((row,idx)=>{
      const memberName=String(row.member || row.name || row.customer || '').trim();
      const date=String(row.date || row.dateISO || '').trim();
      const start=String(row.start || row.time || row.startTime || '').trim();
      const rowLessonRaw=String(row.lessonType || row.lessonName || row.lesson_name || defaultLesson).trim();
      const rowLesson=cleanLessonName(rowLessonRaw,memberName,defaultLesson);
      const lessonFixed=rowLesson!==rowLessonRaw;   // 정규화했으면 결과 표에 표시한다(조용히 바꾸지 않음)
      // 이 행만 강사를 바꾼 경우(강사불일치를 그 자리에서 푸는 용도)가 최우선
      const rowTrainerName=String(rowTrainer[idx] || row.trainer || defaultTrainer).trim();
      const rowDuration=parseInt(row.brojDurationMinutes || row.durationMinutes || defaultDuration)||60;
      const time=buildTime(date,start,row.end || row.endTime,rowDuration);
      if(!memberName || !time) return {idx,row,status:'invalid',memberName,date,start,message:'회원명/날짜/시간 형식을 확인해주세요.'};
      const forcedId=picksArg[idx];
      const forced=forcedId? allMembers.find(m=>String(m.id)===String(forcedId)) : null;
      const match=forced? {member:forced} : findMember(memberName);
      const base={
        idx,row,memberName,date,start,
        startISO:time.startISO,endISO:time.endISO,startDate:time.start,endDate:time.end,
        lessonName:rowLesson || defaultLesson,
        lessonFixed, lessonRaw:rowLessonRaw,
        trainer:rowTrainerName || defaultTrainer,
        duration:rowDuration
      };
      if(!match.member){
        if(match.status==='ambiguous_member') return {...base,status:'ambiguous_member',candidates:match.candidates,message:match.message};
        return {idx,row,status:match.status,memberName,date,start,message:match.message};
      }
      return {...base,status:'pending',member:match.member,manual:!!forced,message:'검사 중'};
    });

    const valid=prepared.filter(x=>x.status==='pending');
    const ambiguous=prepared.filter(x=>x.status==='ambiguous_member');
    const candIds=ambiguous.flatMap(x=>(x.candidates||[]).map(c=>c.id));
    const memberIds=[...new Set([...valid.map(x=>x.member.id), ...candIds])];
    const msByMember={};
    if(memberIds.length){
      const {data,error}=await sb.from('memberships').select('id,member_id,product_name,remaining_count,total_count,end_date,trainer').in('member_id',memberIds).eq('status','활성').gt('remaining_count',0).order('end_date',{nullsFirst:false});
      if(error){ setErr('회원권 조회 실패: '+error.message); return []; }
      (data||[]).forEach(ms=>{ (msByMember[ms.member_id]=msByMember[ms.member_id]||[]).push(ms); });
    }

    let existing=[];
    const timed=[...valid,...ambiguous];
    if(timed.length){
      const min=new Date(Math.min(...timed.map(x=>x.startDate.getTime()))-4*60*60000);
      const max=new Date(Math.max(...timed.map(x=>x.endDate.getTime()))+60000);
      const {data,error}=await sb.from('lessons').select('id,member_id,start_at,end_at,lesson_name,trainer,status').gte('start_at',min.toISOString()).lte('start_at',max.toISOString());
      if(error){ setErr('기존 예약 조회 실패: '+error.message); return []; }
      existing=data||[];
    }

    const remainingByMs={};
    function takeMembership(memberId, trainerName){
      const list=msByMember[memberId]||[];
      const wanted=normTrainer(trainerName);
      for(const ms of list){
        if(normTrainer(ms.trainer)!==wanted) continue;
        const left=remainingByMs[ms.id] ?? ms.remaining_count;
        if(left>0){
          remainingByMs[ms.id]=left-1;
          return ms;
        }
      }
      return null;
    }

    const checked=prepared.map(item=>{
      let it=item;
      if(it.status==='ambiguous_member'){
        // 동명이인 자동판별: 해당 강사 활성 회원권(잔여>0)을 가진 후보만 추림
        const eligible=(it.candidates||[]).filter(c=>{
          const list=msByMember[c.id]||[];
          return list.some(ms=>normTrainer(ms.trainer)===normTrainer(it.trainer) && (remainingByMs[ms.id] ?? ms.remaining_count)>0);
        });
        if(eligible.length===1){
          const member=allMembers.find(m=>String(m.id)===String(eligible[0].id)) || eligible[0];
          it={...it,status:'pending',member,memberName:member.name,autoResolved:true};
        } else {
          return {...it,membership:null,message:eligible.length>1
            ? `조건 맞는 동명이인이 ${eligible.length}명 — 아래에서 회원을 선택하세요.`
            : '동명이인 — 아래에서 회원을 선택하세요.'};
        }
      }
      if(it.status!=='pending') return it;
      const dup=existing.find(l=>String(l.member_id)===String(it.member.id) && Math.abs(new Date(l.start_at).getTime()-it.startDate.getTime())<60000 && l.status!=='취소');
      if(dup) return {...it,status:'duplicate',membership:null,message:'이미 같은 회원/시작시간 예약이 있습니다.'};
      const conflict=existing.find(l=>l.trainer===it.trainer && l.status==='예약' && new Date(l.start_at)<it.endDate && new Date(l.end_at||l.start_at)>it.startDate);
      if(conflict && skipConflicts) return {...it,status:'conflict',membership:null,message:`${it.trainer} ${hm(conflict.start_at)} 기존 예약과 겹칩니다.`};
      const membership=takeMembership(it.member.id,it.trainer);
      if(!membership){
        const list=msByMember[it.member.id]||[];
        const wanted=normTrainer(it.trainer);
        const hasSameTrainer=list.some(ms=>normTrainer(ms.trainer)===wanted);
        if(list.length && !hasSameTrainer){
          const names=[...new Set(list.map(ms=>normTrainer(ms.trainer)||'담당 미지정'))].join(', ');
          return {...it,status:'trainer_mismatch',membership:null,message:`담당강사(${names}) 외 강사로는 등록할 수 없습니다.`};
        }
        if(list.length) return {...it,status:'no_membership',membership:null,message:`${wanted||'선택 강사'} 담당 회원권 잔여횟수가 부족합니다.`};
        if(!allowNoMembership) return {...it,status:'no_membership',membership:null,message:'차감 가능한 활성 회원권이 없습니다.'};
      }
      const tag=(it.autoResolved?` · 자동판별(${it.member.phone||'번호없음'})`:'')+(it.manual?` · 직접지정(${it.member.phone||'번호없음'})`:'');
      return {...it,status:'ready',membership,message:(membership?`${membership.product_name} 차감 예정`:'회원권 없이 예약만 등록')+tag};
    });
    setItems(checked);
    return checked;
  }

  async function pickMember(idx,memberId){
    const next={...picks,[idx]:memberId};
    setPicks(next);
    await buildItems(next);
  }

  // 붙여넣으면 바로 검사한다. 예전엔 붙여넣고 '검사'를 따로 눌러야 했다.
  const buildRef=useRef(buildItems); buildRef.current=buildItems;
  useEffect(()=>{
    if(!text.trim()) return;
    const t=setTimeout(()=>{ buildRef.current().catch(()=>{}); },450);
    return ()=>clearTimeout(t);
  },[text]);

  // 인라인 수정(회원 추가·행별 강사 변경) 후 재검사.
  // ★setTimeout으로 부르면 state 반영 전 옛 closure가 잡힌다. 렌더가 끝난 뒤 도는 effect로 처리한다.
  const skipFirst=useRef(true);
  useEffect(()=>{
    if(skipFirst.current){ skipFirst.current=false; return; }
    if(!text.trim()) return;
    buildRef.current().catch(()=>{});
  },[extra,rowTrainer]);

  function changeRowTrainer(idx,name){ setRowTrainer(r=>({...r,[idx]:name})); }
  // 인라인으로 만든 회원을 목록에 붙이고 그 행에 바로 지정한다
  function memberCreated(m){
    const idx=addMember? addMember.idx : null;
    if(idx!=null) setPicks(p=>({...p,[idx]:m.id}));
    setExtra(x=>[...x,m]);   // 이 변경이 위 effect를 깨워 재검사한다
    setAddMember(null);
  }

  async function registerReady(){
    const checked=items.length?items:await buildItems();
    const ready=checked.filter(x=>x.status==='ready');
    if(!ready.length){ setErr('등록 가능한 일정이 없습니다. 먼저 검사 결과를 확인해주세요.'); return; }
    setBusy(true); setErr('');
    const next=checked.slice();
    const summary={registered:0,error:0};
    for(const item of ready){
      const payload={
        member_id:item.member.id,
        membership_id:item.membership?item.membership.id:null,
        start_at:item.startISO,
        end_at:item.endISO,
        lesson_name:item.lessonName,
        category:lessonCategory(item.lessonName),
        trainer:item.trainer||null,
        status:'예약'
      };
      const {error}=await sb.from('lessons').insert(payload);
      const pos=next.findIndex(x=>x.idx===item.idx);
      if(error){
        summary.error++;
        if(pos>=0) next[pos]={...next[pos],status:'error',message:error.message};
        continue;
      }
      if(item.membership){
        const rpc=await sb.rpc('consume_specific',{p_membership_id:item.membership.id});
        if(rpc.error && pos>=0) next[pos]={...next[pos],status:'error',message:'예약은 저장됐지만 회차 차감 실패: '+rpc.error.message};
        else if(pos>=0) next[pos]={...next[pos],status:'registered',message:'등록 완료'};
      }else if(pos>=0) next[pos]={...next[pos],status:'registered',message:'등록 완료'};
      summary.registered++;
      logAct(sb,'주간 스케줄 가져오기',`${item.memberName} · ${item.lessonName} · ${item.date} ${item.start}`);
    }
    setItems(next);
    setResult(summary);
    setBusy(false);
    onSaved();
  }

  const readyCount=items.filter(x=>x.status==='ready').length;
  const registeredCount=items.filter(x=>x.status==='registered').length;
  // '해결 필요' = 손을 대야 등록되는 것. duplicate(이미 등록됨)는 정상이라 뺀다.
  const BAD=['missing_member','ambiguous_member','no_membership','trainer_mismatch','conflict','invalid','error'];
  const bad=items.filter(x=>BAD.includes(x.status));
  const badCount=bad.length;
  const badBreak=bad.reduce((o,x)=>(o[x.status]=(o[x.status]||0)+1,o),{});
  const shown=onlyBad? bad : items;

  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" style={{maxWidth:860}} onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>주간 스케줄 가져오기</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      {handoff && handoff.payload
        ? <div className="autobar" style={{marginTop:0,marginBottom:12}}>
            📥 주간 스케줄 관리도구에서 <b>{handoff.count||0}건</b>을 받았습니다{handoff.weekLabel?` · ${handoff.weekLabel}`:''} — 아래 검사 결과를 확인하고 등록하세요.
          </div>
        : handoff && handoff.missing
        ? <div className="autobar" style={{marginTop:0,marginBottom:12,color:'#e0a23c'}}>
            전달된 일정을 찾지 못했습니다 (30분이 지났거나 다른 브라우저입니다). 관리도구에서 다시 보내거나 JSON을 붙여넣어주세요.
          </div>
        : <p className="muted" style={{fontSize:13,marginTop:0}}>주간 스케줄 관리도구의 자동등록 JSON을 붙여넣으면 CRM 캘린더 예약으로 일괄 등록합니다.</p>}
      <div className="field"><label>스케줄 JSON</label>
        <textarea value={text} onChange={e=>{setText(e.target.value);setItems([]);setResult(null);setPicks({});}}
          placeholder="브로제이 자동등록 요청 또는 rows JSON을 그대로 붙여넣기"
          style={{width:'100%',minHeight:150,background:'var(--forest)',border:'1px solid var(--line)',borderRadius:8,padding:'10px 12px',color:'var(--cream)',fontSize:12,fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace'}}/>
      </div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>기본 수업명</label><input value={lessonName} onChange={e=>setLessonName(e.target.value)} placeholder="대표 PT"/></div>
        <div className="field" style={{flex:1}}><label>기본 강사</label>
          <input list="trainers" value={trainer} onChange={e=>setTrainer(e.target.value)} placeholder="서민기"/>
          <datalist id="trainers">{trainers.map(t=><option key={t} value={t}/>)}</datalist></div>
        <div className="field" style={{width:110}}><label>기본 길이</label><input type="number" value={duration} onChange={e=>setDuration(e.target.value)} placeholder="60"/></div>
      </div>
      <div style={{display:'flex',gap:14,flexWrap:'wrap',margin:'2px 0 14px'}}>
        <label style={{fontSize:13,color:'var(--muted)'}}><input type="checkbox" checked={skipConflicts} onChange={e=>{setSkipConflicts(e.target.checked);setItems([]);}}/> 강사 시간 겹침은 건너뛰기</label>
        <label style={{fontSize:13,color:'var(--muted)'}}><input type="checkbox" checked={allowNoMembership} onChange={e=>{setAllowNoMembership(e.target.checked);setItems([]);}}/> 활성 회원권 없어도 예약 등록</label>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <button className="btn ghost sm" disabled={busy} onClick={()=>buildItems()}>다시 검사</button>
        <button className="btn" disabled={busy||readyCount===0} onClick={registerReady}>{busy?'등록 중...':`등록 가능 ${readyCount}건 저장`}</button>
        {items.length>0 && <span className="muted" style={{fontSize:13}}>전체 {items.length}건 · 등록완료 {registeredCount}건</span>}
        {badCount>0 && <label style={{fontSize:13,color:'var(--muted)',marginLeft:'auto'}}>
          <input type="checkbox" checked={onlyBad} onChange={e=>setOnlyBad(e.target.checked)}/> 해결 필요만 보기 ({badCount})</label>}
      </div>
      {items.length>0 && badCount>0 && <div className="autobar" style={{marginTop:10}}>
        해결 필요 {badCount}건 — {Object.entries(badBreak).map(([k,v])=>`${BAD_LABEL[k]||k} ${v}`).join(' · ')}
      </div>}
      {err && <div className="err">{err}</div>}
      {result && <div className="autobar" style={{marginTop:12}}>등록 완료 {result.registered}건{result.error?` · 오류 ${result.error}건`:''}</div>}
      {items.length>0 && <div className="list" style={{marginTop:14,maxHeight:330,overflow:'auto'}}>
        <table className="ptable">
          <thead><tr><th>상태</th><th>회원</th><th>일시</th><th>수업</th><th>회원권/메시지</th></tr></thead>
          <tbody>{shown.map(item=>(
            <tr key={item.idx}>
              <td>{statusBadge(item.status)}</td>
              <td>
                {item.memberName||'-'}
                {item.status==='ambiguous_member' && item.candidates && (
                  <select value={picks[item.idx]||''} onChange={e=>pickMember(item.idx,e.target.value)}
                    style={{display:'block',marginTop:4,width:'100%',fontSize:12}}>
                    <option value="">회원 선택…</option>
                    {item.candidates.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone||'번호없음'}</option>)}
                  </select>
                )}
                {item.status==='missing_member' && (
                  <button className="btn ghost sm" style={{marginTop:4,fontSize:12}}
                    onClick={()=>setAddMember({idx:item.idx,name:item.memberName})}>＋ 이 회원 등록</button>
                )}
              </td>
              <td>{item.date||'-'} {item.start||''}</td>
              <td>
                {item.lessonName||lessonName} · {item.trainer||trainer}
                {item.lessonFixed && <div className="muted" style={{fontSize:11,marginTop:2}}
                  title="수업명 칸에 회원 이름이 들어와 있어 기본 수업명으로 바꿨습니다">
                  ↳ 수업명 정규화 (원본 '{item.lessonRaw}')</div>}
                {item.status==='trainer_mismatch' && (
                  <select value={rowTrainer[item.idx]||item.trainer||''} onChange={e=>changeRowTrainer(item.idx,e.target.value)}
                    style={{display:'block',marginTop:4,width:'100%',fontSize:12}}>
                    {[...new Set([item.trainer,...trainers])].filter(Boolean).map(t=><option key={t} value={t}>{t}(으)로 변경</option>)}
                  </select>
                )}
              </td>
              <td className="muted">
                {item.message}
                {(item.status==='no_membership'||item.status==='trainer_mismatch') && item.member && (
                  <button className="btn ghost sm" style={{display:'block',marginTop:4,fontSize:12}}
                    onClick={()=>setAddMs({member:item.member})}>＋ 회원권 등록</button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>}
      {addMember && <AddMemberModal sb={sb} initName={addMember.name}
        onClose={()=>setAddMember(null)} onSaved={memberCreated}/>}
      {addMs && <RegisterModal sb={sb} member={addMs.member}
        onClose={()=>setAddMs(null)} onSaved={()=>{ setAddMs(null); buildItems(); }}/>}
    </div></div>
  );
}

// ---------- 우클릭 메뉴 (수업 완료/휴강/노쇼) ----------
// ★반드시 body로 포털한다.
//   `.main>div`에 fadeIn 애니메이션이 걸려 있는데(index.html `.main>div{animation:gl-fadeIn ... both}`),
//   transform을 건드리는 애니메이션은 **값이 항등행렬이어도** 그 요소를 position:fixed 자식의
//   기준 박스(containing block)로 만든다. 그래서 메뉴를 캘린더 안에 두면 left/top이 뷰포트가 아니라
//   그 div 기준이 되어 클릭 지점에서 한참 오른쪽에 떴다(2026-08-01 실측: +349px, 금요일 열은 화면 밖 67px 잘림).
//   → body로 빼면 기준이 뷰포트로 돌아온다. (AGENTS.md의 backdrop-filter 함정과 같은 계열)
// ★폭을 상수로 가정하지 않는다. 예전엔 `innerWidth-160`으로 접었는데 실제 메뉴는 그보다 넓어서
//   오른쪽 끝에서 글씨가 잘렸다. 렌더 후 실측해서, 오른쪽이 모자라면 클릭 지점의 왼쪽으로 펼친다.
function CtxMenu({x,y,onClose,children}){
  const ref=useRef(null);
  const [pos,setPos]=useState({left:x,top:y,ready:false});
  useLayoutEffect(()=>{
    const el=ref.current; if(!el) return;
    const {width,height}=el.getBoundingClientRect();
    const M=8;   // 화면 가장자리 여백
    const left = (x+width+M > window.innerWidth)  ? Math.max(M, x-width)  : x;
    const top  = (y+height+M > window.innerHeight)? Math.max(M, y-height) : y;
    setPos({left,top,ready:true});
  },[x,y]);
  return createPortal(
    <div className="ctx" ref={ref}
      style={{left:pos.left,top:pos.top,visibility:pos.ready?'visible':'hidden'}}
      onClick={e=>e.stopPropagation()}
      onContextMenu={e=>{e.preventDefault();e.stopPropagation();}}>
      {children}
    </div>, document.body);
}

// ---------- 그날 전체보기 ----------
function DayModal({date,items,memberName,chipStyle,onClose,onCtx,onMember}){
  useEsc(onClose);
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>{date} · 수업 {items.length}건</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <p className="muted" style={{fontSize:12,marginTop:0}}>회원 이름을 클릭하면 상세정보, 우클릭하면 완료/휴강/노쇼 처리할 수 있어요.</p>
      <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:'60vh',overflowY:'auto'}}>
        {items.length===0? <div className="muted">수업 없음</div> :
          items.map(l=>(
          <button key={l.id} className={'chip '+l.status} style={{...(chipStyle?chipStyle(l):null),fontSize:13,padding:'9px 11px'}}
            onClick={()=>{ if(l.member_id && onMember) onMember(l); }}
            onContextMenu={e=>{e.preventDefault(); onCtx({x:e.clientX,y:e.clientY,l});}}>
            {hmRange(l)} · {l.member_id?memberName(l.member_id)+' · ':''}{l.lesson_name} <span className={'mini '+l.status}>{l.status}</span>
          </button>))}
      </div>
    </div></div>
  );
}

// ---------- 노쇼 사유 ----------
function NoshowModal({lesson,onClose,onConfirm}){
  useEsc(onClose);
  const [reason,setReason]=useState('');
  return (
    <div className="modal-ov top" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>노쇼 처리</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <p className="muted" style={{fontSize:13,marginTop:0}}>{lesson.lesson_name} · {fmtDT(lesson.start_at)} · 차감은 유지됩니다.</p>
      <div className="field"><label>노쇼 사유</label>
        <input autoFocus value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 연락 없이 불참"/></div>
      <button className="btn" onClick={()=>onConfirm(reason)}>노쇼 처리</button>
    </div></div>
  );
}

// ---------- 그날 일정 (모바일 · 시간축) ----------
// 월 보기에서 날짜를 누르면 열린다. 그날 수업을 시간 순서대로 한 창에 보여주고
// 수업을 누르면 시간수정·휴강·노쇼·삭제로 이어진다.
function DayScheduleModal({date,items,memberName,trainerColors,onPick,onAdd,onClose}){
  useEsc(onClose);
  const DOW=['일','월','화','수','목','금','토'];
  const d=new Date(`${date}T00:00:00+09:00`);
  const list=items.slice().sort((a,b)=>a.start_at<b.start_at?-1:1);
  const done=list.filter(l=>l.status==='완료').length;
  const rest=list.filter(l=>l.status==='휴강').length;
  const ns=list.filter(l=>l.status==='노쇼').length;
  const book=list.filter(l=>l.status==='예약').length;
  return (<div className="modal-ov" onClick={onClose}><div className="modal dsm" onClick={e=>e.stopPropagation()}>
    <div className="mhead">
      <h3>{d.getMonth()+1}월 {d.getDate()}일 ({DOW[d.getDay()]}) · 수업 {list.length}건</h3>
      <button className="xbtn" onClick={onClose}>✕</button>
    </div>
    {list.length>0 && <p className="muted" style={{fontSize:12,margin:'0 0 10px'}}>
      예약 {book} · 완료 {done}{ns?` · 노쇼 ${ns}`:''}{rest?` · 휴강 ${rest}`:''} — 수업을 누르면 시간수정·휴강·노쇼·삭제
    </p>}
    {list.length===0
      ? <div className="empty" style={{padding:'26px 0'}}>이날 수업이 없습니다</div>
      : <div className="dsm-list">
          {list.map(l=>{ const tc=l.trainer?trainerColors[l.trainer]:'#3a4b44';
            return (<button key={l.id} className={'dsm-row st-'+l.status} onClick={()=>onPick(l)}>
              <span className="dsm-time">{hm(l.start_at)}<i>{l.end_at?hm(l.end_at):''}</i></span>
              <span className="dsm-bar" style={{background:tc}}/>
              <span className="dsm-body">
                <b>{l.member_id?memberName(l.member_id):(l.lesson_name||'수업')}</b>
                <small>{l.lesson_name} · {l.trainer||'강사 미지정'}{l.noshow_reason?` · 노쇼: ${l.noshow_reason}`:''}</small>
              </span>
              <span className={'mini '+l.status}>{l.status}</span>
            </button>); })}
        </div>}
    <button className="btn" style={{width:'100%',marginTop:12}} onClick={onAdd}>＋ 이날 수업 추가</button>
  </div></div>);
}

// ---------- 수업 삭제 (회차 처리 선택) ----------
// ★예전엔 휴강이 아니면 무조건 회차를 +1 복구했다. 그런데 실제로는 두 경우가 다르다.
//   · 아직 안 한 수업을 지우는 것 → 회차를 돌려줘야 한다
//   · 이미 한 수업의 기록만 지우는 것 → 회차는 그대로 둬야 한다
//   자동으로 정할 수 없어서 물어본다.
function DeleteLessonModal({lesson,memberName,onClose,onConfirm}){
  useEsc(onClose);
  const hasMs=!!lesson.membership_id;
  // 휴강은 이미 복구된 상태 → 기본은 '유지'. 그 외는 예전 동작대로 '복구'.
  const [restore,setRestore]=useState(lesson.status!=='휴강');
  const [busy,setBusy]=useState(false);
  const who=lesson.member_id? memberName(lesson.member_id) : null;
  return (<div className="modal-ov top" onClick={onClose}><div className="modal" style={{maxWidth:420}} onClick={e=>e.stopPropagation()}>
    <div className="mhead"><h3>수업 삭제</h3><button className="xbtn" onClick={onClose}>✕</button></div>
    <p className="muted" style={{fontSize:13,marginTop:0}}>
      {who?who+' · ':''}{lesson.lesson_name} · {lesson.trainer||'강사 미지정'}<br/>
      <span style={{fontSize:12}}>{fmtDT(lesson.start_at)} · 현재 {lesson.status}</span>
    </p>
    {hasMs? <>
      <div className="field"><label>회차를 어떻게 할까요?</label></div>
      <label className={'pickbox'+(restore?' on':'')} onClick={()=>setRestore(true)}>
        <input type="radio" checked={restore} readOnly/>
        <span><b>회차 돌려주기 (+1)</b><small>수업을 안 한 것으로 처리합니다. 잘못 넣었거나 취소된 수업.</small></span>
      </label>
      <label className={'pickbox'+(!restore?' on':'')} onClick={()=>setRestore(false)}>
        <input type="radio" checked={!restore} readOnly/>
        <span><b>회차 그대로 두기</b><small>수업은 진행됐고 기록만 지웁니다. 잔여 회차가 바뀌지 않습니다.</small></span>
      </label>
    </> : <p className="muted" style={{fontSize:12}}>이 수업은 회원권에 연결돼 있지 않아 회차 변동이 없습니다.</p>}
    <p className="muted" style={{fontSize:12,margin:'12px 0'}}>삭제하면 되돌릴 수 없습니다.</p>
    <div style={{display:'flex',gap:8}}>
      <button className="btn ghost" style={{flex:1}} onClick={onClose}>취소</button>
      <button className="btn" style={{flex:1,background:'#8c3b2c',color:'#fff',boxShadow:'none'}}
        disabled={busy} onClick={()=>{setBusy(true);onConfirm(hasMs?restore:false);}}>
        {busy?'삭제 중...':'삭제'}</button>
    </div>
  </div></div>);
}

// ---------- 수업 시간 수정 ----------
// 우클릭 메뉴에서 연다. 날짜·시작시간·길이만 바꾼다.
// ★회차는 건드리지 않는다 — 차감은 '예약을 만들 때' 이미 끝났고, 시간을 옮기는 건
//   차감 여부와 무관하다. 여기서 회차를 손대면 이중차감/과복구가 된다.
function EditLessonTimeModal({sb,lesson,memberName,onClose,onSaved}){
  useEsc(onClose);
  const st=new Date(lesson.start_at);
  const en=lesson.end_at?new Date(lesson.end_at):null;
  const curDur=en? Math.max(5,Math.round((en-st)/60000)) : 50;
  const [date,setDate]=useState(ymd(st));
  const [start,setStart]=useState(`${pad(st.getHours())}:${pad(st.getMinutes())}`);
  const [dur,setDur]=useState(String(curDur));
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  const who=lesson.member_id? (memberName(lesson.member_id)+' · ') : '';

  function calc(){
    const m=String(start||'').match(/^(\d{1,2}):(\d{2})$/);
    if(!date||!m) return null;
    const s=new Date(`${date}T${pad(m[1])}:${m[2]}:00+09:00`);
    if(isNaN(s)) return null;
    const d=parseInt(dur)||0; if(d<5||d>300) return null;
    return {s,e:new Date(s.getTime()+d*60000)};
  }
  const t=calc();
  const changed = t && (t.s.getTime()!==st.getTime() || (en? t.e.getTime()!==en.getTime() : true));

  async function save(){
    const t=calc();
    if(!t) return setErr('날짜·시작시간·길이(5~300분)를 확인해주세요.');
    setBusy(true); setErr('');
    const sIso=t.s.toISOString(), eIso=t.e.toISOString();

    // ① 같은 회원이 그 시각에 이미 다른 수업이 있는지 (자기 자신은 제외)
    if(lesson.member_id){
      const {data:mine}=await sb.from('lessons').select('id,start_at,lesson_name,status')
        .eq('member_id',lesson.member_id).neq('id',lesson.id).neq('status','취소')
        .gte('start_at',new Date(t.s.getTime()-12*3600000).toISOString())
        .lte('start_at',new Date(t.s.getTime()+12*3600000).toISOString());
      const dup=(mine||[]).find(l=>Math.abs(new Date(l.start_at).getTime()-t.s.getTime())<60000);
      if(dup){ setBusy(false);
        return setErr(`이 회원은 그 시각에 이미 수업이 있습니다 (${dup.lesson_name||'수업'} · ${dup.status}). 시간을 바꿔주세요.`); }
    }
    // ② 같은 강사 시간 겹침 — 막지 않고 물어본다(연강·대타 등 실제로 겹칠 수 있다)
    if(lesson.trainer){
      const {data:ex}=await sb.from('lessons').select('id,start_at,end_at,lesson_name')
        .eq('trainer',lesson.trainer).eq('status','예약').neq('id',lesson.id)
        .gte('start_at',new Date(t.s.getTime()-12*3600000).toISOString())
        .lte('start_at',new Date(t.s.getTime()+12*3600000).toISOString());
      const c=(ex||[]).find(l=> l.start_at < eIso && (l.end_at||l.start_at) > sIso);
      if(c && !confirm(`⚠️ ${lesson.trainer} 강사가 ${hm(c.start_at)}에 이미 예약이 있습니다 (${c.lesson_name}).\n그래도 이 시간으로 옮길까요?`)){
        setBusy(false); return; }
    }
    const {error}=await sb.from('lessons').update({start_at:sIso,end_at:eIso}).eq('id',lesson.id);
    setBusy(false);
    if(error) return setErr('저장 실패: '+error.message);
    logAct(sb,'수업 시간 변경',`${who}${lesson.lesson_name} · ${fmtDT(lesson.start_at)} → ${fmtDT(sIso)}`);
    onSaved();
  }

  return (<div className="modal-ov top" onClick={onClose}><div className="modal" style={{maxWidth:420}} onClick={e=>e.stopPropagation()}>
    <div className="mhead"><h3>수업 시간 수정</h3><button className="xbtn" onClick={onClose}>✕</button></div>
    <p className="muted" style={{fontSize:13,marginTop:0}}>
      {who}{lesson.lesson_name} · {lesson.trainer||'강사 미지정'}<br/>
      <span style={{fontSize:12}}>현재: {fmtDT(lesson.start_at)}{en?` ~ ${hm(lesson.end_at)}`:''} ({curDur}분)</span>
    </p>
    <div className="field"><label>날짜</label>
      <input type="date" value={date} onChange={e=>setDate(e.target.value||date)}/></div>
    <div className="row2">
      <div className="field" style={{flex:1}}><label>시작 시간</label>
        <input type="time" value={start} onChange={e=>setStart(e.target.value)}/></div>
      <div className="field" style={{width:110}}><label>길이(분)</label>
        <input type="number" value={dur} onChange={e=>setDur(e.target.value)}/></div>
    </div>
    <div className="seg" style={{marginBottom:12}}>
      {[30,50,60,90].map(n=>(
        <button key={n} type="button" className={String(n)===String(dur)?'on':''} onClick={()=>setDur(String(n))}>{n}분</button>))}
    </div>
    {t && <p className="muted" style={{fontSize:12,margin:'-4px 0 10px'}}>
      바꾼 뒤: <b style={{color:'var(--cream)'}}>{fmtDT(t.s.toISOString())} ~ {hm(t.e.toISOString())}</b>
    </p>}
    <p className="muted" style={{fontSize:12,margin:'0 0 12px'}}>시간만 바뀌고 회차·상태는 그대로입니다.</p>
    {err && <div className="err">{err}</div>}
    <button className="btn" style={{width:'100%'}} disabled={busy||!t||!changed} onClick={save}>
      {busy?'저장 중...':changed?'시간 변경':'변경할 내용이 없습니다'}</button>
  </div></div>);
}

// ---------- 월 빠른 이동 ----------
function MonthPicker({cur,onPick}){
  const [y,setY]=useState(cur.getFullYear());
  return (
    <div className="picker" onClick={e=>e.stopPropagation()}>
      <div className="picker-year"><button onClick={()=>setY(y-1)}>‹</button><b>{y}년</b><button onClick={()=>setY(y+1)}>›</button></div>
      <div className="picker-months">{Array.from({length:12},(_,i)=>i+1).map(m=>(
        <button key={m} className={(y===cur.getFullYear()&&m===cur.getMonth()+1)?'on':''} onClick={()=>onPick(y,m)}>{m}월</button>))}</div>
    </div>
  );
}

// ---------- 캘린더 ----------
function CalendarView({sb}){
  const today=new Date();
  const [cur,setCur]=useState(new Date(today.getFullYear(),today.getMonth(),1));
  const [lessons,setLessons]=useState([]);
  const [members,setMembers]=useState([]);
  const [ctx,setCtx]=useState(null);
  const [booking,setBooking]=useState(null);
  const [noshow,setNoshow]=useState(null);
  const [editTime,setEditTime]=useState(null);   // 우클릭 → 수업 시간 수정
  const [delTarget,setDelTarget]=useState(null); // 삭제 시 회차 처리를 물어볼 대상
  const [daySheet,setDaySheet]=useState(null);   // 모바일 월 보기에서 날짜를 눌렀을 때 (YYYY-MM-DD)
  const [importer,setImporter]=useState(false);
  const [autoMsg,setAutoMsg]=useState('');
  const [picker,setPicker]=useState(false);
  const [dayView,setDayView]=useState(null);
  const [memberDetail,setMemberDetail]=useState(null); // 칩 좌클릭 → 회원 상세(패널)
  const [mode,setMode]=useState('month');
  const [anchor,setAnchor]=useState(()=>new Date(today.getFullYear(),today.getMonth(),today.getDate()));
  // 모바일(≤860px) = 현장용 전용 캘린더
  const [isMobile,setIsMobile]=useState(()=>window.matchMedia('(max-width:860px)').matches);
  // 모바일 보기 모드: 일(아젠다) · 주(시간격자) · 월(달력). 마지막 선택을 기억한다.
  const [mobView,setMobView]=useState(()=>{ try{ return localStorage.getItem('gl_mobview')||'day'; }catch(e){ return 'day'; } });
  useEffect(()=>{ try{ localStorage.setItem('gl_mobview',mobView); }catch(e){} },[mobView]);
  useEffect(()=>{ const mq=window.matchMedia('(max-width:860px)'); const h=e=>setIsMobile(e.matches);
    mq.addEventListener('change',h); return ()=>mq.removeEventListener('change',h); },[]);
  const [sheet,setSheet]=useState(null); // 모바일 액션시트 대상 수업
  const weekStart=new Date(anchor); weekStart.setDate(anchor.getDate()-anchor.getDay()); weekStart.setHours(0,0,0,0);
  const weekDates=Array.from({length:7},(_,i)=>{ const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return d; });
  const weekEnd=new Date(weekStart); weekEnd.setDate(weekStart.getDate()+7);

  async function loadLessons(){
    let s,e;
    // 모바일: 월 보기면 그 달을, 일·주 보기면 보는 주만 로드
    if(isMobile){
      if(mobView==='month'){ s=new Date(anchor.getFullYear(),anchor.getMonth(),1); e=new Date(anchor.getFullYear(),anchor.getMonth()+1,1); }
      else { s=new Date(weekStart); e=new Date(weekEnd); }
    }
    else if(mode==='day'){ s=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()); e=new Date(s); e.setDate(e.getDate()+1); }
    else if(mode==='week'){ s=new Date(weekStart); e=new Date(weekEnd); }
    else { s=new Date(cur.getFullYear(),cur.getMonth(),1); e=new Date(cur.getFullYear(),cur.getMonth()+1,1); }
    const {data}=await sb.from('lessons').select('*').gte('start_at',s.toISOString()).lt('start_at',e.toISOString()).order('start_at');
    setLessons(data||[]);
  }
  useEffect(()=>{ (async()=>{
    const {data:n}=await sb.rpc('auto_complete_overdue');
    if(n>0) setAutoMsg(`지난 예약 ${n}건을 자동 완료 처리했습니다.`);
    loadLessons();
  })(); },[cur,mode,anchor,isMobile,mobView]);
  useEffect(()=>{
    fetchAll(()=>sb.from('members').select('id,name,phone,status').order('name').order('id')).then(({data})=>setMembers(data||[]));
    sb.from('lessons').select('trainer').not('trainer','is',null).order('start_at',{ascending:false}).limit(5000).then(({data})=>setTrainerPool([...new Set((data||[]).map(r=>r.trainer).filter(Boolean))]));
    sb.from('trainer_colors').select('name,color').then(({data,error})=>{ if(!error&&data){ const m={}; data.forEach(r=>m[r.name]=r.color); setColorOverrides(m); } });
  },[]);
  // 관리도구에서 `?import=1`로 넘어왔으면 가져오기 모달을 자동으로 연다.
  // ★회원 목록이 도착한 뒤에 열어야 한다 — 비어 있는 상태로 검사하면 전부 '회원없음'으로 잡힌다.
  const [handoff,setHandoff]=useState(null);
  const handoffDone=useRef(false);
  useEffect(()=>{
    if(handoffDone.current) return;
    if(!/[?&]import=1/.test(location.search)) return;
    if(!members.length) return;
    handoffDone.current=true;
    const h=takeScheduleHandoff();
    setHandoff(h || {missing:true});
    setImporter(true);
    // 주소창에서 ?import=1 을 지운다 — 새로고침할 때 또 열리지 않게
    try{ history.replaceState(null,'',location.pathname+location.hash); }catch(e){}
  },[members]);

  const memberById = useMemo(()=>{ const m={}; members.forEach(x=>m[x.id]=x); return m; },[members]);
  const memberName = id => (memberById[id]&&memberById[id].name) || '?';
  const [trainerPool,setTrainerPool]=useState([]);
  const [trainerFilter,setTrainerFilter]=useState('all');
  const [colorOverrides,setColorOverrides]=useState({});
  const [editColors,setEditColors]=useState(false);
  const trainers = useMemo(()=>[...new Set([...trainerPool,...lessons.map(l=>l.trainer).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'ko')),[trainerPool,lessons]);
  const trainerColors = useMemo(()=>{ const m={}; trainers.forEach((t,i)=>{ m[t]=colorOverrides[t]||TRAINER_PALETTE[i%TRAINER_PALETTE.length]; }); return m; },[trainers,colorOverrides]);
  const colorTimers = useRef({});
  function setTrainerColor(name,color){
    setColorOverrides(o=>({...o,[name]:color})); // 드래그 중 즉시 미리보기(로컬만)
    clearTimeout(colorTimers.current[name]);
    colorTimers.current[name]=setTimeout(async()=>{ // 드래그가 끝난 뒤 최종 색만 1회 저장 (로그 안 남김)
      try{ await sb.from('trainer_colors').upsert({name,color,updated_at:new Date().toISOString()},{onConflict:'name'}); }catch(e){}
    },450);
  }
  const chipStyle=l=>{ const tc=l.trainer?trainerColors[l.trainer]:null; if(!tc) return undefined;
    const s={background:tc,color:trainerFg(tc),borderLeftColor:'rgba(0,0,0,.28)'};
    if(l.status==='완료') s.opacity=.72;
    else if(l.status==='휴강'){ s.opacity=.4; s.textDecoration='line-through'; }
    else if(l.status==='노쇼'){ s.opacity=.6; s.textDecoration='line-through'; }
    return s; };

  // 차감 상태: 휴강만 미차감, 그 외(예약/완료/노쇼)는 차감 반영
  // ★회차 조정과 상태 변경 중 하나만 성공하면 회차가 조용히 어긋난다. 게다가 예전엔 실패해도
  //   logAct가 "수업 완료"라고 찍어서 **감사 로그가 사실과 달라졌다**(장부로 쓰는 앱에서 제일 위험).
  //   → 회차를 먼저 조정하고, 상태 변경이 실패하면 반대 RPC로 되돌린다(consume↔restore가 대칭이라 가능).
  //     로그는 둘 다 성공했을 때만 남긴다.
  async function setStatus(l,to,reason){
    let undo=null;   // 상태 변경 실패 시 회차를 원위치시킬 RPC
    if(l.membership_id){
      const wasC = l.status!=='휴강', willC = to!=='휴강';
      if(!wasC && willC){
        const {error}=await sb.rpc('consume_specific',{p_membership_id:l.membership_id});
        if(error){ alert('회차 차감에 실패해 중단했습니다.\n'+error.message); setCtx(null); setNoshow(null); return; }
        undo='restore_session';
      } else if(wasC && !willC){
        const {error}=await sb.rpc('restore_session',{p_membership_id:l.membership_id});
        if(error){ alert('회차 복구에 실패해 중단했습니다.\n'+error.message); setCtx(null); setNoshow(null); return; }
        undo='consume_specific';
      }
    }
    const {error}=await sb.from('lessons').update({status:to, noshow_reason: to==='노쇼'?(reason||null):null}).eq('id',l.id);
    if(error){
      if(undo) await sb.rpc(undo,{p_membership_id:l.membership_id});   // 회차만 바뀌는 상태를 막는다
      alert('수업 상태를 바꾸지 못했습니다.\n'+error.message+(undo?'\n(회차는 원래대로 되돌렸습니다)':''));
      setCtx(null); setNoshow(null); return;
    }
    logAct(sb,'수업 '+to,`${l.member_id?memberName(l.member_id)+' · ':''}${l.lesson_name} · ${fmtDT(l.start_at)}${to==='노쇼'&&reason?` (사유: ${reason})`:''}`);
    setCtx(null); setNoshow(null); loadLessons();
  }
  // 삭제는 회차 처리를 물어본 뒤 실행한다 (DeleteLessonModal)
  function del(l){ setDelTarget(l); setCtx(null); }
  // ★삭제를 먼저 하고 회차를 복구한다. 반대로 하면 삭제가 실패했을 때 회차만 늘어난다.
  async function doDelete(l,restore){
    const {error}=await sb.from('lessons').delete().eq('id',l.id);
    if(error){ alert('수업 삭제에 실패했습니다.\n'+error.message); setDelTarget(null); return; }
    if(restore && l.membership_id){
      const {error:rErr}=await sb.rpc('restore_session',{p_membership_id:l.membership_id});
      if(rErr) alert(`수업은 삭제됐지만 회차 복구에 실패했습니다.\n${rErr.message}\n\n회원 상세 → 회원권 수정에서 잔여 회차를 직접 +1 해주세요.`);
    }
    logAct(sb,'수업 삭제',`${l.member_id?memberName(l.member_id)+' · ':''}${l.lesson_name} · ${fmtDT(l.start_at)}`
      +(l.membership_id? (restore?' (회차 복구)':' (회차 유지)') : ''));
    setDelTarget(null); loadLessons();
  }
  // 수업 칩 좌클릭 → 회원 상세(요일 헤더 아래 패널). 우클릭은 상태메뉴 유지.
  async function openMemberDetail(l,e){
    if(!l||!l.member_id) return;
    const {data}=await sb.from('members').select('*').eq('id',l.member_id).single();
    if(!data) return; // RLS로 안 보이는 회원(배정 아님)
    let top=176;
    try{ const g=e&&e.currentTarget&&e.currentTarget.closest('.cal-grid'); const dow=g&&g.querySelector('.cal-dow');
      if(dow) top=Math.round(dow.getBoundingClientRect().bottom+6); }catch(_){}
    setMemberDetail({member:data,top});
  }

  const first=new Date(cur.getFullYear(),cur.getMonth(),1);
  const gridStart=new Date(first); gridStart.setDate(1-first.getDay());
  const cells=[]; for(let i=0;i<42;i++){ const d=new Date(gridStart); d.setDate(gridStart.getDate()+i); cells.push(d); }
  const viewLessons = trainerFilter==='all'? lessons : lessons.filter(l=>l.trainer===trainerFilter);
  const byDate={}; viewLessons.forEach(l=>{ const k=ymd(new Date(l.start_at)); (byDate[k]=byDate[k]||[]).push(l); });
  const todayKey=ymd(today);

  const goPrev=()=>{ if(mode==='day'){ const d=new Date(anchor); d.setDate(d.getDate()-1); setAnchor(d); } else if(mode==='week'){ const d=new Date(anchor); d.setDate(d.getDate()-7); setAnchor(d); } else setCur(new Date(cur.getFullYear(),cur.getMonth()-1,1)); };
  const goNext=()=>{ if(mode==='day'){ const d=new Date(anchor); d.setDate(d.getDate()+1); setAnchor(d); } else if(mode==='week'){ const d=new Date(anchor); d.setDate(d.getDate()+7); setAnchor(d); } else setCur(new Date(cur.getFullYear(),cur.getMonth()+1,1)); };
  const goToday=()=>{ setAnchor(new Date(today.getFullYear(),today.getMonth(),today.getDate())); setCur(new Date(today.getFullYear(),today.getMonth(),1)); };
  const weekEndD=weekDates[6];
  // '＋ 일정 추가' 버튼 기본 날짜: 지금 보고 있는 화면 맥락에 맞춤(모달 안에서 변경 가능)
  const bookingDate=()=>{
    if(isMobile||mode==='day') return ymd(anchor);
    if(mode==='week') return (today>=weekStart&&today<weekEnd)? todayKey : ymd(weekStart);
    return (today.getFullYear()===cur.getFullYear()&&today.getMonth()===cur.getMonth())? todayKey : ymd(new Date(cur.getFullYear(),cur.getMonth(),1));
  };

  return (<div onClick={()=>{ if(ctx)setCtx(null); if(picker)setPicker(false); }}>
    {!isMobile && <div className="cal-head">
      <div className="seg" style={{width:170,marginRight:6}}>
        <button className={mode==='month'?'on':''} onClick={()=>setMode('month')}>월</button>
        <button className={mode==='week'?'on':''} onClick={()=>setMode('week')}>주</button>
        <button className={mode==='day'?'on':''} onClick={()=>setMode('day')}>일</button>
      </div>
      <button className="btn ghost sm" onClick={goPrev}>‹</button>
      {mode==='month'
        ? <button className="mtitle-btn" onClick={e=>{e.stopPropagation(); setPicker(p=>!p);}}>{cur.getFullYear()}년 {cur.getMonth()+1}월 ▾</button>
        : mode==='week'
        ? <span className="mtitle-btn" style={{cursor:'default'}}>{weekStart.getMonth()+1}/{weekStart.getDate()} ~ {weekEndD.getMonth()+1}/{weekEndD.getDate()}</span>
        : <span className="mtitle-btn" style={{cursor:'default'}}>{anchor.getFullYear()}년 {anchor.getMonth()+1}/{anchor.getDate()} ({['일','월','화','수','목','금','토'][anchor.getDay()]}) · 강사별</span>}
      <button className="btn ghost sm" onClick={goNext}>›</button>
      <button className="btn ghost sm" onClick={goToday}>오늘</button>
      <button className="btn sm" onClick={e=>{e.stopPropagation(); setBooking({date:bookingDate()});}}>＋ 일정 추가</button>
      <button className="btn ghost sm" onClick={e=>{e.stopPropagation();setImporter(true);}}>주간스케줄 가져오기</button>
      <div className="muted" style={{marginLeft:'auto',fontSize:13}}>날짜 클릭=예약 · 회원 클릭=상세 · 수업 우클릭=완료/휴강/노쇼</div>
      {picker && mode==='month' && <MonthPicker cur={cur} onPick={(y,m)=>{ setCur(new Date(y,m-1,1)); setPicker(false); }}/>}
    </div>}
    {autoMsg && <div className="autobar">{autoMsg}</div>}
    {trainers.length>0 && <div className="trainer-legend">
      <button className={'tl-chip'+(trainerFilter==='all'?' on':'')} onClick={()=>setTrainerFilter('all')}>전체 강사</button>
      {trainers.map(t=>(
        <button key={t} className={'tl-chip'+(trainerFilter===t?' on':'')} onClick={()=>setTrainerFilter(f=>f===t?'all':t)}
          style={trainerFilter===t?{background:trainerColors[t],color:trainerFg(trainerColors[t]),borderColor:'transparent'}:undefined}>
          <i style={{background:trainerColors[t]}}/>{t}
        </button>))}
      {trainerFilter!=='all' && <span className="muted" style={{fontSize:12,alignSelf:'center',marginLeft:2}}>· '{trainerFilter}' 강사 수업만 표시 중</span>}
      <button className={'tl-chip'+(editColors?' on':'')} style={{marginLeft:'auto'}} onClick={()=>setEditColors(v=>!v)}>🎨 색상 {editColors?'완료':'편집'}</button>
    </div>}
    {trainers.length>0 && editColors && <div className="trainer-legend" style={{marginTop:-4,marginBottom:14}}>
      <span className="muted" style={{fontSize:12,alignSelf:'center'}}>색상 네모를 눌러 강사별 색을 바꾸세요 (모든 기기 공유) →</span>
      {trainers.map(t=>(
        <label key={t} className="tl-chip" style={{cursor:'pointer'}} title={t+' 색상 선택'}>
          <input type="color" value={trainerColors[t]} onChange={e=>setTrainerColor(t,e.target.value)}
            style={{width:18,height:18,border:'none',background:'none',padding:0,cursor:'pointer'}}/>{t}
        </label>))}
    </div>}
    {isMobile ? (()=>{ // ── 모바일 전용 캘린더: 일 / 주 / 월 ──
      const selKey=ymd(anchor);
      const items=(byDate[selKey]||[]).slice().sort((a,b)=>a.start_at<b.start_at?-1:1);
      const nowIso=new Date().toISOString();
      const nextL=(selKey===todayKey)? items.find(l=>l.status==='예약'&&l.start_at>=nowIso) : null;
      const DOW=['일','월','화','수','목','금','토'];
      const isMonth=mobView==='month';
      // 이동: 월 보기는 한 달씩, 일·주 보기는 한 주씩
      const step=n=>{ const d=new Date(anchor);
        if(isMonth) d.setMonth(d.getMonth()+n); else d.setDate(d.getDate()+7*n);
        setAnchor(d); setCur(new Date(d.getFullYear(),d.getMonth(),1)); };
      // 칩 라벨: 색으로 강사를 구분하므로 이름은 회원만 (사용자 요청)
      const label=l=> l.member_id? memberName(l.member_id) : (l.lesson_name||'수업');
      const evColor=l=> l.trainer? trainerColors[l.trainer] : '#3a4b44';
      const evStyle=l=>{ const bg=evColor(l);
        const s={background:bg,color:trainerFg(bg)};
        if(l.status==='완료') s.opacity=.68;
        else if(l.status==='휴강'){ s.opacity=.38; s.textDecoration='line-through'; }
        else if(l.status==='노쇼'){ s.opacity=.55; s.textDecoration='line-through'; }
        return s; };

      return (<div className="agenda">
        <div className="ag-head">
          <button className="btn ghost sm" onClick={()=>step(-1)}>‹</button>
          <button className="mtitle-btn" onClick={e=>{e.stopPropagation(); setPicker(p=>!p);}}>{anchor.getFullYear()}년 {anchor.getMonth()+1}월 ▾</button>
          <button className="btn ghost sm" onClick={()=>step(1)}>›</button>
          <button className="btn ghost sm" style={{marginLeft:'auto'}} onClick={goToday}>오늘</button>
          {picker && <MonthPicker cur={anchor} onPick={(y,m)=>{ const d=new Date(y,m-1,1); setAnchor(d); setCur(d); setPicker(false); }}/>}
        </div>
        <div className="seg mob-seg">
          {[['day','일'],['week','주'],['month','월']].map(([k,lbl])=>(
            <button key={k} className={mobView===k?'on':''} onClick={()=>setMobView(k)}>{lbl}</button>))}
        </div>

        {/* ── 일: 현장용 아젠다 (기존) ── */}
        {mobView==='day' && <>
          <div className="ag-week">
            {weekDates.map((d,i)=>{ const k=ymd(d); const cnt=(byDate[k]||[]).length;
              return (<button key={i} className={'ag-day'+(k===selKey?' sel':'')+(k===todayKey?' today':'')}
                  onClick={()=>{ if(k===selKey) setBooking({date:k}); else setAnchor(new Date(d)); }}>
                <span className="ag-dow">{DOW[i]}</span>
                <span className="ag-num">{d.getDate()}</span>
                <span className={'ag-dot'+(cnt?' on':'')}/>
              </button>); })}
          </div>
          <div className="ag-title">{anchor.getMonth()+1}월 {anchor.getDate()}일 ({DOW[anchor.getDay()]}) · 수업 {items.length}건 <span style={{opacity:.6}}>· 카드=완료/노쇼 · 날짜 다시 탭=예약</span></div>
          {items.length===0? <div className="empty" style={{cursor:'pointer'}} onClick={()=>setBooking({date:selKey})}>이날 수업이 없습니다 · 아래 ＋ 버튼으로 예약</div> :
            items.map(l=>{ const tc=l.trainer?trainerColors[l.trainer]:'var(--line)';
              return (<button key={l.id} className={'ag-card'+(nextL&&l.id===nextL.id?' next':'')+(l.status!=='예약'?' st-'+l.status:'')}
                style={{borderLeftColor:tc}} onClick={()=>setSheet(l)}>
                <div className="ag-time">{hmRange(l)}</div>
                <div className="ag-body">
                  <b>{l.member_id?memberName(l.member_id)+' · ':''}{l.lesson_name}</b>
                  <span className="muted">{l.trainer||'강사 미지정'}{l.noshow_reason?' · 노쇼: '+l.noshow_reason:''}</span>
                </div>
                <span className={'mini '+l.status}>{l.status}</span>
              </button>); })}
          {items.length>0 && <button className="ag-add" onClick={()=>setBooking({date:selKey})}>＋ 수업 추가</button>}
        </>}

        {/* ── 주: 구글 캘린더식 시간 격자 ── */}
        {mobView==='week' && (()=>{
          const HOUR=54;                       // 1시간 높이(px)
          const wk=weekDates.map(d=>(byDate[ymd(d)]||[]));
          const all=wk.flat();
          // 보여줄 시간대: 실제 수업 범위에 맞춰 잘라낸다(빈 새벽·심야를 안 그린다)
          let h0=7,h1=22;
          if(all.length){
            const sh=Math.min(...all.map(l=>new Date(l.start_at).getHours()));
            const eh=Math.max(...all.map(l=>{const e=l.end_at?new Date(l.end_at):new Date(new Date(l.start_at).getTime()+50*60000);
              return e.getHours()+(e.getMinutes()>0?1:0);}));
            h0=Math.min(h0,sh); h1=Math.max(h1,eh);
          }
          const hours=Array.from({length:Math.max(1,h1-h0)},(_,i)=>h0+i);
          const H=hours.length*HOUR;
          // 겹치는 수업은 옆으로 나눠 배치 (강사가 여럿이면 같은 시간에 겹칠 수 있다)
          const lay=list=>{
            const evs=list.map(l=>{ const s=new Date(l.start_at);
              const e=l.end_at?new Date(l.end_at):new Date(s.getTime()+50*60000);
              return {l,s:s.getHours()*60+s.getMinutes(),e:Math.max(e.getHours()*60+e.getMinutes(),s.getHours()*60+s.getMinutes()+20)};})
              .sort((a,b)=>a.s-b.s||a.e-b.e);
            let i=0;
            while(i<evs.length){                     // 겹침 덩어리 단위로 폭을 나눈다
              let j=i, end=evs[i].e;
              while(j+1<evs.length && evs[j+1].s < end){ j++; end=Math.max(end,evs[j].e); }
              const grp=evs.slice(i,j+1), lanes=[];
              grp.forEach(ev=>{ let k=0; while(k<lanes.length && lanes[k]>ev.s) k++; ev.lane=k; lanes[k]=ev.e; });
              grp.forEach(ev=>ev.cols=lanes.length);
              i=j+1;
            }
            return evs;
          };
          return (<div className="mw">
            <div className="mw-head">
              <div className="mw-gut"/>
              {weekDates.map((d,i)=>{ const k=ymd(d);
                return (<button key={i} className={'mw-dh'+(k===todayKey?' today':'')+(i===0?' sun':'')+(i===6?' sat':'')}
                    onClick={()=>{ setAnchor(new Date(d)); setMobView('day'); }}>
                  <span>{DOW[i]}</span><b>{d.getDate()}</b>
                </button>); })}
            </div>
            <div className="mw-body">
              <div className="mw-times" style={{height:H}}>
                {hours.map(h=><div key={h} className="mw-t" style={{height:HOUR}}>{pad(h)}:00</div>)}
              </div>
              {weekDates.map((d,di)=>(
                <div key={di} className={'mw-col'+(ymd(d)===todayKey?' today':'')} style={{height:H,backgroundSize:`100% ${HOUR}px`}}
                     onClick={()=>setBooking({date:ymd(d)})}>
                  {lay(wk[di]).map(ev=>{
                    const top=(ev.s-h0*60)/60*HOUR, hgt=Math.max(16,(ev.e-ev.s)/60*HOUR-2);
                    // 겹쳐서 칸이 좁아지면(3개 이상) 시간 라벨을 접고 이름만 남긴다 — 13px에 두 줄은 못 읽는다
                    const narrow=ev.cols>2, short=hgt<30;
                    return (<button key={ev.l.id} className={'mw-ev'+(narrow?' narrow':'')}
                      style={{...evStyle(ev.l),top,height:hgt,
                              left:`calc(${ev.lane/ev.cols*100}% + 1px)`, width:`calc(${100/ev.cols}% - 2px)`}}
                      title={`${hm(ev.l.start_at)} ${label(ev.l)} · ${ev.l.trainer||''}`}
                      onClick={e=>{e.stopPropagation(); setSheet(ev.l);}}>
                      {!narrow && !short && <i>{hm(ev.l.start_at)}</i>}{label(ev.l)}
                    </button>); })}
                </div>))}
            </div>
            <div className="muted" style={{fontSize:11,padding:'8px 2px 0'}}>블록=수업(색=강사) · 탭하면 처리 · 빈칸 탭=예약 · 요일 탭=그날 보기</div>
          </div>);
        })()}

        {/* ── 월: 날짜별 회원명 칩 ── */}
        {mobView==='month' && (()=>{
          const first=new Date(anchor.getFullYear(),anchor.getMonth(),1);
          const gs=new Date(first); gs.setDate(1-first.getDay());
          const cells=Array.from({length:42},(_,i)=>{ const d=new Date(gs); d.setDate(gs.getDate()+i); return d; });
          const MAX=2;   // 칸당 보여줄 칩 수 — 넘으면 +N
          return (<div className="mm">
            <div className="mm-dow">{DOW.map((d,i)=><span key={i} className={i===0?'sun':i===6?'sat':''}>{d}</span>)}</div>
            <div className="mm-grid">
              {cells.map((d,i)=>{ const k=ymd(d);
                const list=(byDate[k]||[]).slice().sort((a,b)=>a.start_at<b.start_at?-1:1);
                const inM=d.getMonth()===anchor.getMonth();
                return (<button key={i} className={'mm-cell'+(inM?'':' other')+(k===todayKey?' today':'')}
                    onClick={()=>setDaySheet(k)}>
                  <span className="mm-num">{d.getDate()}</span>
                  {list.slice(0,MAX).map(l=>(
                    <i key={l.id} className="mm-ev" style={evStyle(l)}>{label(l)}</i>))}
                  {list.length>MAX && <em className="mm-more">+{list.length-MAX}</em>}
                </button>); })}
            </div>
            <div className="muted" style={{fontSize:11,padding:'8px 2px 0'}}>색=강사 · 날짜를 탭하면 그날 일정이 열립니다</div>
          </div>);
        })()}
      </div>);
    })() : mode==='day' ? (()=>{
      const k=ymd(anchor); const items=(byDate[k]||[]).slice().sort((a,b)=>a.start_at<b.start_at?-1:1);
      const byT={}; items.forEach(l=>{ const t=l.trainer||'미지정'; (byT[t]=byT[t]||[]).push(l); });
      const cols=Object.keys(byT).sort((a,b)=>a==='미지정'?1:b==='미지정'?-1:a.localeCompare(b,'ko'));
      if(cols.length===0) return <div className="empty" style={{cursor:'pointer'}} onClick={()=>setBooking({date:k})}>이날 수업이 없습니다 · 클릭하여 예약</div>;
      return (<div className="cal-grid cal-week" style={{gridTemplateColumns:`repeat(${cols.length},minmax(150px,1fr))`}}>
        {cols.map(t=><div className="cal-dow" key={'h'+t} style={t!=='미지정'&&trainerColors[t]?{color:trainerColors[t],fontWeight:800}:undefined}>{t} · {(byT[t]||[]).length}건</div>)}
        {cols.map(t=>(<div key={t} className={'cal-cell'+(k===todayKey?' today':'')} onClick={()=>setBooking({date:k})}>
          <div className="cal-items" onClick={e=>e.stopPropagation()}>
            {(byT[t]||[]).map(l=>(
              <button key={l.id} className={'chip '+l.status} style={{...chipStyle(l),fontSize:12,padding:'5px 7px'}}
                onClick={e=>{e.stopPropagation(); openMemberDetail(l,e);}}
                onContextMenu={e=>{e.preventDefault();e.stopPropagation(); setCtx({x:e.clientX,y:e.clientY,l});}}>
                {hmRange(l)} {l.member_id?memberName(l.member_id)+' ':''}{l.lesson_name}
              </button>))}
          </div>
        </div>))}
      </div>);
    })() : mode==='week' ? (
    <div className="cal-grid cal-week">
      {weekDates.map((d,i)=><div className={'cal-dow'+(d.getDay()===0?' sun':'')} key={'h'+i}>{['일','월','화','수','목','금','토'][i]} {d.getMonth()+1}/{d.getDate()}</div>)}
      {weekDates.map((d,i)=>{ const k=ymd(d); const items=byDate[k]||[];
        return (<div key={i} className={'cal-cell'+(d.getDay()===0?' sun':'')+(k===todayKey?' today':'')} onClick={()=>setBooking({date:k})}>
          <div className="cal-items" onClick={e=>e.stopPropagation()}>
            {items.length===0? <div className="muted" style={{fontSize:11,padding:'2px 4px'}}>—</div> :
              items.map(l=>(
              <button key={l.id} className={'chip '+l.status} style={chipStyle(l)}
                onClick={e=>{e.stopPropagation(); openMemberDetail(l,e);}}
                onContextMenu={e=>{e.preventDefault();e.stopPropagation(); setCtx({x:e.clientX,y:e.clientY,l});}}>
                {hmRange(l)} {l.member_id?memberName(l.member_id)+' ':''}{l.lesson_name}
              </button>))}
          </div>
        </div>); })}
    </div>
    ) : (
    <div className="cal-grid">
      {['일','월','화','수','목','금','토'].map(d=><div className="cal-dow" key={d}>{d}</div>)}
      {cells.map((d,i)=>{ const k=ymd(d); const inMonth=d.getMonth()===cur.getMonth(); const items=byDate[k]||[];
        return (<div key={i} className={'cal-cell'+(inMonth?'':' other')+(d.getDay()===0?' sun':'')+(k===todayKey?' today':'')}
                  onClick={()=>setBooking({date:k})}>
          <div className="cal-dnum">{d.getDate()}</div>
          <div className="cal-items" onClick={e=>e.stopPropagation()}>
            {items.map(l=>(
              <button key={l.id} className={'chip '+l.status} style={chipStyle(l)}
                onClick={e=>{e.stopPropagation(); openMemberDetail(l,e);}}
                onContextMenu={e=>{e.preventDefault();e.stopPropagation(); setCtx({x:e.clientX,y:e.clientY,l});}}>
                {hmRange(l)} {l.member_id?memberName(l.member_id)+' ':''}{l.lesson_name}
              </button>))}
          </div>
          {items.length>0 && <button className="morebtn" onClick={e=>{e.stopPropagation(); setDayView({date:k});}}>전체 {items.length}건 ▸</button>}
        </div>); })}
    </div>
    )}

    {ctx && (<CtxMenu x={ctx.x} y={ctx.y} onClose={()=>setCtx(null)}>
      <div className="ctx-head">{ctx.l.member_id?memberName(ctx.l.member_id)+' · ':''}{ctx.l.lesson_name} · {hmRange(ctx.l)}</div>
      <button onClick={()=>setStatus(ctx.l,'완료')}>✓ 수업 완료</button>
      <button onClick={()=>setStatus(ctx.l,'휴강')}>⊘ 수업 휴강 (+1 복구)</button>
      <button onClick={()=>setNoshow(ctx.l)}>✗ 수업 노쇼 (차감 유지)</button>
      {(ctx.l.status!=='예약') && <button onClick={()=>setStatus(ctx.l,'예약')}>↺ 예약으로 되돌리기</button>}
      <button onClick={()=>{ setEditTime(ctx.l); setCtx(null); }}>🕐 수업 시간 수정</button>
      <button className="danger" onClick={()=>del(ctx.l)}>🗑 수업 삭제</button>
    </CtxMenu>)}

    {booking && <BookingModal sb={sb} date={booking.date} members={members} trainers={trainers}
        onClose={()=>setBooking(null)} onSaved={()=>{setBooking(null);loadLessons();}}/>}
    {importer && <ScheduleImportModal sb={sb} members={members} trainers={trainers} handoff={handoff}
        onClose={()=>{setImporter(false);setHandoff(null);}} onSaved={()=>loadLessons()}/>}
    {noshow && <NoshowModal lesson={noshow} onClose={()=>setNoshow(null)} onConfirm={r=>setStatus(noshow,'노쇼',r)}/>}
    {dayView && <DayModal date={dayView.date} items={byDate[dayView.date]||[]} memberName={memberName} chipStyle={chipStyle}
        onClose={()=>setDayView(null)} onCtx={c=>setCtx(c)} onMember={l=>{ setDayView(null); openMemberDetail(l); }}/>}
    {/* ★DayModal 뒤에 둔다 — 둘 다 .modal-ov(z-index 30)라 나중에 그려진 쪽이 위로 온다.
        앞에 두면 '그날 전체보기'에서 우클릭해 연 이 창이 뒤에 깔려 안 보인다. */}
    {/* 모바일 월 보기에서 날짜를 누르면 여는 '그날 일정' 창 (시간축) */}
    {isMobile && daySheet && <DayScheduleModal date={daySheet}
        items={byDate[daySheet]||[]} memberName={memberName} trainerColors={trainerColors}
        onPick={l=>setSheet(l)} onAdd={()=>setBooking({date:daySheet})} onClose={()=>setDaySheet(null)}/>}
    {editTime && <EditLessonTimeModal sb={sb} lesson={editTime} memberName={memberName}
        onClose={()=>setEditTime(null)} onSaved={()=>{setEditTime(null);setDayView(null);loadLessons();}}/>}
    {delTarget && <DeleteLessonModal lesson={delTarget} memberName={memberName}
        onClose={()=>setDelTarget(null)} onConfirm={r=>doDelete(delTarget,r)}/>}
    {memberDetail && <Detail sb={sb} member={memberDetail.member} panel panelTop={memberDetail.top}
        onClose={()=>{ setMemberDetail(null); loadLessons(); }}/>}

    {isMobile && sheet && createPortal(<>
      <div className="sheet-ov" onClick={()=>setSheet(null)}/>
      <div className="sheet">
        <div className="sheet-head">
          <b>{sheet.member_id?memberName(sheet.member_id)+' · ':''}{sheet.lesson_name}</b>
          <span className="muted">{hmRange(sheet)} · {sheet.trainer||'강사 미지정'} · <span className={'mini '+sheet.status}>{sheet.status}</span></span>
        </div>
        <button onClick={()=>{setStatus(sheet,'완료');setSheet(null);}}>✓ 수업 완료</button>
        <button onClick={()=>{setStatus(sheet,'휴강');setSheet(null);}}>⊘ 휴강 (+1 복구)</button>
        <button onClick={()=>{setNoshow(sheet);setSheet(null);}}>✗ 노쇼 (차감 유지)</button>
        {sheet.status!=='예약' && <button onClick={()=>{setStatus(sheet,'예약');setSheet(null);}}>↺ 예약으로 되돌리기</button>}
        <button onClick={()=>{setEditTime(sheet);setSheet(null);}}>🕐 수업 시간 수정</button>
        <button className="danger" onClick={()=>{del(sheet);setSheet(null);}}>🗑 수업 삭제</button>
        <button className="cancel" onClick={()=>setSheet(null)}>닫기</button>
      </div>
    </>, document.body)}
    {isMobile && createPortal(
      <button className="fab" onClick={()=>setBooking({date:ymd(anchor)})} aria-label="수업 예약">＋</button>,
      document.body)}
  </div>);
}

// ---------- 락커 배정 ----------
function LockerAssign({sb,locker,members,onClose,onSaved}){
  useEsc(onClose);
  const [q,setQ]=useState(''),[selM,setSelM]=useState(null);
  const t=new Date(); const plus=m=>{const d=new Date(t);d.setMonth(d.getMonth()+m);return d;};
  const [sd,setSd]=useState(ymd(t)),[ed,setEd]=useState(ymd(plus(1))),[unlimited,setUnlimited]=useState(false),[pw,setPw]=useState(''),[memo,setMemo]=useState('');
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  const cands=q?members.filter(m=>{const d=q.replace(/\D/g,'');return (m.name||'').includes(q)||(d&&(m.phone||'').replace(/\D/g,'').includes(d));}).slice(0,8):[];
  async function save(){
    if(!selM) return setErr('회원을 선택하세요');
    setBusy(true);
    const {error}=await sb.from('lockers').update({member_id:selM.id,status:'활성',start_date:sd||null,end_date:unlimited?null:(ed||null),unlimited,password:pw||null,memo:memo||null}).eq('id',locker.id);
    if(!error) logAct(sb,'락커 배정',`${selM.name} · ${locker.number}번`);
    setBusy(false); if(error){ setErr('저장 실패: '+error.message); return; } onSaved();
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>{locker.number}번 락커 배정</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      {!selM? <>
        <div className="field"><label>회원 검색</label><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="이름 또는 전화"/></div>
        {cands.length>0 && <div className="mlist">{cands.map(m=><button key={m.id} onClick={()=>setSelM(m)}>{m.name} <span className="muted">{m.phone||''}</span></button>)}</div>}
      </> : <>
        <div className="field"><label>회원</label><div className="card" style={{margin:0,display:'flex',justifyContent:'space-between'}}><b>{selM.name}</b><button className="link" style={{margin:0}} onClick={()=>setSelM(null)}>변경</button></div></div>
        <div className="row2">
          <div className="field" style={{flex:1}}><label>시작일</label><input type="date" value={sd} onChange={e=>setSd(e.target.value)}/></div>
          <div className="field" style={{flex:1}}><label>만료일</label><input type="date" value={ed} onChange={e=>setEd(e.target.value)} disabled={unlimited}/></div>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:14,margin:'2px 0 10px',cursor:'pointer'}}><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)}/> 무제한 사용</label>
        <div className="row2">
          <div className="field" style={{flex:1}}><label>비밀번호</label><input value={pw} onChange={e=>setPw(e.target.value)} placeholder="선택"/></div>
          <div className="field" style={{flex:1}}><label>메모</label><input value={memo} onChange={e=>setMemo(e.target.value)} placeholder="선택"/></div>
        </div>
        <button className="btn" disabled={busy} onClick={save}>{busy?'저장 중...':'배정'}</button>
      </>}
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 락커 상세 ----------
function LockerDetail({sb,locker,lockers,memberName,onClose,onSaved}){
  useEsc(onClose);
  const [ed,setEd]=useState(locker.end_date||''),[unlimited,setUnlimited]=useState(locker.unlimited||false);
  const [pw,setPw]=useState(locker.password||''),[memo,setMemo]=useState(locker.memo||'');
  const [busy,setBusy]=useState(false);
  const [moving,setMoving]=useState(false);
  const [logRows,setLogRows]=useState(null); // null=숨김
  const emptyLockers=(lockers||[]).filter(l=>!l.member_id&&l.status!=='고장'&&l.id!==locker.id);
  async function save(){ setBusy(true); await sb.from('lockers').update({end_date:unlimited?null:(ed||null),unlimited,password:pw||null,memo:memo||null}).eq('id',locker.id); setBusy(false); onSaved(); }
  async function release(){ if(!confirm(locker.number+'번 락커를 회수할까요?')) return; await sb.from('lockers').update({member_id:null,status:'미배정',start_date:null,end_date:null,unlimited:false,password:null,memo:null}).eq('id',locker.id); logAct(sb,'락커 회수',`${memberName(locker.member_id)||''} · ${locker.number}번`); onSaved(); }
  async function broken(){ await sb.from('lockers').update({status: locker.status==='고장'?(locker.member_id?'활성':'미배정'):'고장'}).eq('id',locker.id); onSaved(); }
  async function moveTo(target){
    if(!confirm(`${locker.number}번 → ${target.number}번으로 옮길까요?\n기간·비밀번호·메모가 그대로 이동합니다.`)) return;
    const {error}=await sb.from('lockers').update({member_id:locker.member_id,status:'활성',start_date:locker.start_date,end_date:unlimited?null:(ed||null),unlimited,password:pw||null,memo:memo||null}).eq('id',target.id);
    if(error) return alert('이동 실패: '+error.message);
    await sb.from('lockers').update({member_id:null,status:'미배정',start_date:null,end_date:null,unlimited:false,password:null,memo:null}).eq('id',locker.id);
    logAct(sb,'락커 이동',`${memberName(locker.member_id)||''} · ${locker.number}번 → ${target.number}번`);
    onSaved();
  }
  async function toggleLogs(){
    if(logRows!==null){ setLogRows(null); return; }
    const {data}=await sb.from('logs').select('*').ilike('action','락커%').order('at',{ascending:false}).limit(300);
    const re=new RegExp(`(^|[^0-9])${locker.number}번`);
    setLogRows((data||[]).filter(r=>re.test(r.detail||'')).slice(0,20));
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>{locker.number}번 락커</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      {locker.member_id && <div className="field"><label>배정 회원</label><div className="card" style={{margin:0}}><b>{memberName(locker.member_id)}</b></div></div>}
      <div className="row2">
        <div className="field" style={{flex:1}}><label>만료일</label><input type="date" value={ed} onChange={e=>setEd(e.target.value)} disabled={unlimited}/></div>
        <div className="field" style={{flex:1,display:'flex',alignItems:'flex-end'}}><label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',marginBottom:9}}><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)}/> 무제한</label></div>
      </div>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>비밀번호</label><input value={pw} onChange={e=>setPw(e.target.value)}/></div>
        <div className="field" style={{flex:1}}><label>메모</label><input value={memo} onChange={e=>setMemo(e.target.value)}/></div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:6}}>
        <button className="btn" style={{flex:1}} disabled={busy} onClick={save}>저장</button>
        {locker.member_id && <button className="btn ghost" onClick={()=>setMoving(v=>!v)}>이동{moving?' 닫기':''}</button>}
        <button className="btn ghost" onClick={broken}>{locker.status==='고장'?'고장 해제':'고장'}</button>
        {locker.member_id && <button className="btn ghost" style={{color:'#d98b7a',borderColor:'#5a2e28'}} onClick={release}>회수</button>}
      </div>
      {moving && <div style={{marginTop:12}}>
        <div className="muted" style={{fontSize:12,marginBottom:6}}>옮길 빈 락커를 선택하세요 ({emptyLockers.length}개)</div>
        {emptyLockers.length===0? <div className="muted" style={{fontSize:13}}>빈 락커가 없습니다</div> :
          <div className="lkpick-grid">{emptyLockers.map(l=>
            <button key={l.id} className="lkpick empty" onClick={()=>moveTo(l)}>{l.number}</button>)}</div>}
      </div>}
      <button className="link" style={{marginTop:12}} onClick={toggleLogs}>{logRows===null?'▸ 이 락커의 기록 보기':'▾ 기록 닫기'}</button>
      {logRows!==null && (logRows.length===0? <div className="muted" style={{fontSize:13}}>기록이 없습니다</div> :
        logRows.map(r=>(<div className="kv" key={r.id} style={{fontSize:13}}>
          <span>{fmtDT(r.at)} · <b style={{color:'var(--cream)'}}>{r.action}</b></span><span className="muted" style={{marginLeft:8,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:220}} title={r.detail||''}>{r.detail||''}</span>
        </div>)))}
    </div></div>
  );
}

// ---------- 락커 추가 ----------
function LockerAdd({sb,room,existing,onClose,onSaved}){
  useEsc(onClose);
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function save(){
    const f=parseInt(from),t=parseInt(to);
    if(!f||!t||t<f) return setErr('번호 범위를 올바르게 입력하세요');
    const rows=[]; for(let n=f;n<=t;n++){ if(!existing.has(n)) rows.push({number:n,room,status:'미배정'}); }
    if(rows.length===0) return setErr('이미 존재하는 번호입니다');
    setBusy(true); const {error}=await sb.from('lockers').insert(rows); setBusy(false);
    if(error){ setErr('저장 실패: '+error.message); return; } onSaved();
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>락커 추가</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <p className="muted" style={{fontSize:13,marginTop:0}}>번호 범위를 입력하면 그만큼 빈 락커가 생성됩니다.</p>
      <div className="row2">
        <div className="field" style={{flex:1}}><label>시작 번호</label><input type="number" value={from} onChange={e=>setFrom(e.target.value)} placeholder="1"/></div>
        <div className="field" style={{flex:1}}><label>끝 번호</label><input type="number" value={to} onChange={e=>setTo(e.target.value)} placeholder="50"/></div>
      </div>
      <button className="btn" disabled={busy} onClick={save}>{busy?'생성 중...':'락커 생성'}</button>
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 락커관리 ----------
function LockersView({sb}){
  const room='개인라커';
  const [lockers,setLockers]=useState(null);
  const [members,setMembers]=useState([]);
  const [assign,setAssign]=useState(null),[detail,setDetail]=useState(null),[adding,setAdding]=useState(false);
  const [tab,setTab]=useState('전체');
  async function load(){ const {data}=await sb.from('lockers').select('*').eq('room',room).order('number'); setLockers(data||[]); }
  useEffect(()=>{ load(); fetchAll(()=>sb.from('members').select('id,name,phone').order('name').order('id')).then(({data})=>setMembers(data||[])); },[]);
  const memberById=useMemo(()=>{const m={};members.forEach(x=>m[x.id]=x);return m;},[members]);
  const memberName=id=>(memberById[id]&&memberById[id].name)||'';
  const today=ymd(new Date());
  function st(l){ if(l.status==='고장')return '고장'; if(!l.member_id)return '미배정';
    if(!l.unlimited&&l.end_date){ if(l.end_date<today)return '만료';
      const dd=Math.ceil((new Date(l.end_date)-new Date(today))/86400000); if(dd<=14) return '임박'; }
    return '활성'; }
  const counts={전체:0,활성:0,임박:0,미배정:0,만료:0,고장:0};
  (lockers||[]).forEach(l=>{ counts.전체++; const s=st(l); if(counts[s]!==undefined)counts[s]++; });
  const existing=new Set((lockers||[]).map(l=>l.number));
  const shown=(lockers||[]).filter(l=> tab==='전체'|| st(l)===tab);

  if(lockers===null) return <div className="empty">락커 불러오는 중...</div>;
  if(lockers.length===0) return (<div style={{textAlign:'center',padding:'50px 20px'}}>
    <div className="muted" style={{marginBottom:14}}>아직 등록된 락커가 없습니다.</div>
    <button className="btn" onClick={()=>setAdding(true)}>락커 추가하기</button>
    {adding && <LockerAdd sb={sb} room={room} existing={existing} onClose={()=>setAdding(false)} onSaved={()=>{setAdding(false);load();}}/>}
  </div>);

  return (<div>
    <div className="stats">
      <div className="stat"><div className="n">{counts.전체}</div><div className="l">전체 락커</div></div>
      <div className="stat"><div className="n" style={{color:'#7dc4a0'}}>{counts.활성}</div><div className="l">사용중</div></div>
      <div className="stat"><div className="n" style={{color:'#e0a23c'}}>{counts.임박}</div><div className="l">임박 (14일)</div></div>
      <div className="stat"><div className="n muted">{counts.미배정}</div><div className="l">비어있음</div></div>
      <div className="stat"><div className="n" style={{color:'#d98b7a'}}>{counts.만료}</div><div className="l">만료</div></div>
    </div>
    <div className="bar">
      <div className="tabs">{[['전체','전체'],['활성','사용중'],['임박','임박'],['미배정','비어있음'],['만료','만료'],['고장','고장']].map(([k,lbl])=><button key={k} className={'tab'+(tab===k?' on':'')} onClick={()=>setTab(k)}>{lbl} {counts[k]!==undefined?counts[k]:0}</button>)}</div>
      <button className="btn sm" onClick={()=>setAdding(true)}>＋ 락커 추가</button>
    </div>
    <div className="locker-grid">
      {shown.map(l=>{ const s=st(l);
        return (l.member_id || l.status==='고장')?
          <div key={l.id} className={'locker '+s} onClick={()=>setDetail(l)}>
            <div className="lk-top"><span className="lk-num">{l.number}번</span><span className={'lk-st '+s}>{s}</span></div>
            <div className="lk-name">{l.member_id?memberName(l.member_id):'고장'}</div>
            <div className="lk-exp">{l.unlimited?'무제한':(l.end_date?'~'+l.end_date:'')}</div>
          </div>
        : <div key={l.id} className="locker empty" onClick={()=>setAssign(l)}>
            <span className="lk-num">{l.number}번</span><span className="lk-plus">＋</span>
          </div>;
      })}
    </div>
    {assign && <LockerAssign sb={sb} locker={assign} members={members} onClose={()=>setAssign(null)} onSaved={()=>{setAssign(null);load();}}/>}
    {detail && <LockerDetail sb={sb} locker={detail} lockers={lockers} memberName={memberName} onClose={()=>setDetail(null)} onSaved={()=>{setDetail(null);load();}}/>}
    {adding && <LockerAdd sb={sb} room={room} existing={existing} onClose={()=>setAdding(false)} onSaved={()=>{setAdding(false);load();}}/>}
  </div>);
}

// ---------- 홈 대시보드 ----------
function DashboardView({sb,onNav,onLogout}){
  const {can,role}=usePerm();
  const [members,setMembers]=useState(null);
  const [ms,setMs]=useState([]);
  const [sel,setSel]=useState(null);
  const [lessons,setLessons]=useState([]);
  const [tasks,setTasks]=useState(null); // null=로딩, 'na'=notes_tasks.sql 미실행
  const [lockers,setLockers]=useState([]);
  const [taskModal,setTaskModal]=useState(false);
  const [taskFor,setTaskFor]=useState(null); // {member, initTitle} — 위젯 행에서 만든 회원 할일
  const [loadErr,setLoadErr]=useState('');
  async function load(){
    try{ await sb.rpc('expire_overdue'); }catch(e){}
    // 지난 예약 자동완료 + 회차차감. 캘린더 탭에서만 돌던 것을 홈에서도 돌린다.
    // (캘린더를 안 열면 수업이 끝나도 '예약'으로 남아 회차가 안 깎이고,
    //  그 결과 잔여회차가 실제보다 많게 보여 재등록 대상 추출이 늦어졌다)
    try{ await sb.rpc('auto_complete_overdue'); }catch(e){}
    const cut=new Date(Date.now()-42*86400000).toISOString();
    const [a,b,c,d,e]=await Promise.all([
      fetchAll(()=>sb.from('members').select('*').order('name').order('id')),
      fetchAll(()=>sb.from('memberships').select('*').order('id')),
      sb.from('lessons').select('member_id,start_at,status').gte('start_at',cut).not('member_id','is',null).limit(5000),
      sb.from('tasks').select('*').eq('done',false).order('due_date',{ascending:true,nullsFirst:false}).limit(100),
      // 락커는 회원권과 달리 자동 만료·회수가 없다. 방치되면 배정이 남아 "비어있음"에서 빠지고
      // 재판매가 안 된다(2026-07-30에 34개·최고 703일 방치 발견). 만료 전에 연장을 받는 게 최선이라 홈에 띄운다.
      sb.from('lockers').select('id,number,room,member_id,end_date,unlimited,status').not('member_id','is',null).limit(1000)
    ]);
    // ★조회 실패를 빈 배열로 삼키면 "회원 0명 · 매출 0원"으로 보인다 — 데이터가 날아간 것처럼 읽힌다.
    //   (세션 만료가 대표적인 원인. 실제로 JWT 만료 시 이 화면이 전부 0이 된다)
    //   실패했으면 숫자를 0으로 덮어쓰지 말고 배너로 알린다.
    const failed=[a,b,c,e].find(r=>r && r.error);
    if(failed){ setLoadErr(failed.error.message||'조회에 실패했습니다.'); return; }
    setLoadErr('');
    setMembers(a.data||[]); setMs(b.data||[]);
    setLessons(c.data||[]);
    setTasks(d.error?'na':(d.data||[]));   // tasks는 SQL 미실행일 수 있어 별도 처리
    setLockers(e.data||[]);
  }
  async function completeTask(t){
    const {error}=await sb.from('tasks').update({done:true,done_at:new Date().toISOString()}).eq('id',t.id);
    if(error) return alert('완료 처리 실패: '+error.message);
    logAct(sb,'할일 완료',t.title);
    setTasks(ts=>Array.isArray(ts)?ts.filter(x=>x.id!==t.id):ts);
  }
  useEffect(()=>{ load(); },[]);
  const memById=useMemo(()=>{const o={};(members||[]).forEach(m=>o[m.id]=m);return o;},[members]);
  const today=new Date(); const t0=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const dday=end=>{ if(!end)return null; const d=new Date(end); if(isNaN(d))return null; return Math.ceil((new Date(d.getFullYear(),d.getMonth(),d.getDate())-t0)/86400000); };
  const soon=(ms||[]).filter(m=>m.status==='활성').map(m=>({m,d:dday(m.end_date)})).filter(x=>x.d!==null&&x.d>=0&&x.d<=14).sort((a,b)=>a.d-b.d);
  const holding=(ms||[]).filter(m=>m.status==='홀딩');
  // 잔여횟수 임박: 활성 회차권 중 잔여 3회 이하 (재등록 영업 대상)
  const lowCount=(ms||[]).filter(m=>m.status==='활성'&&(m.total_count||0)>0&&(m.remaining_count||0)<=3).sort((a,b)=>(a.remaining_count||0)-(b.remaining_count||0));
  // 최근 30일 내 만료됐고 현재 유효(활성/홀딩) 회원권이 없는 회원 = 재등록 권유 대상
  const churn=(()=>{ const hasLive=new Set((ms||[]).filter(m=>m.status==='활성'||m.status==='홀딩').map(m=>m.member_id));
    const lim=new Date(t0); lim.setDate(lim.getDate()-30); const best={};
    (ms||[]).forEach(m=>{ if(m.status!=='만료'||!m.end_date||hasLive.has(m.member_id)) return;
      const d=new Date(m.end_date); if(isNaN(d)||d<lim||d>t0) return;
      if(!best[m.member_id]||m.end_date>best[m.member_id].end_date) best[m.member_id]=m; });
    return Object.values(best).sort((a,b)=>(b.end_date||'').localeCompare(a.end_date||'')); })();
  const unpaid=(ms||[]).filter(m=>(m.unpaid||0)>0).sort((a,b)=>b.unpaid-a.unpaid);
  // 락커 만료·임박: 배정된 락커 중 무제한·고장 제외, D-14 이하(이미 지난 것 포함).
  // 만료된 칸은 실물에 짐이 남아 있을 수 있어 자동 회수하지 않는다 — 사람이 확인하도록 띄우기만 한다.
  const lkSoon=(lockers||[]).filter(l=>l.status!=='고장'&&!l.unlimited&&l.end_date)
    .map(l=>({l,d:dday(l.end_date)})).filter(x=>x.d!==null&&x.d<=14)
    .sort((a,b)=>a.d-b.d);
  const lkOver=lkSoon.filter(x=>x.d<0);
  const lastLessonAgo=(()=>{
    if(!lessons.length) return null;
    const newest=Math.max(...lessons.map(l=>new Date(l.start_at).getTime()));
    return Math.floor((Date.now()-newest)/86400000);
  })();

  // 생일 위젯이 "없습니다"만 보여주면 데이터가 비어서인지 진짜 없는지 구분이 안 된다.
  const noBirth=(members||[]).filter(m=>!m.birth).length;

  // 주간 스케줄 등록 현황 — 실사용의 54%가 이 작업인데 홈에 지표가 없었다.
  // 이번 주/지난 주 등록 건수를 나란히 보여주고, 비었으면 바로 캘린더로 보낸다.
  const weekStat=(()=>{
    const d=new Date(t0); const dow=d.getDay();
    const thisStart=new Date(d); thisStart.setDate(d.getDate()-dow);        // 이번 주 일요일
    const nextStart=new Date(thisStart); nextStart.setDate(thisStart.getDate()+7);
    const prevStart=new Date(thisStart); prevStart.setDate(thisStart.getDate()-7);
    const inR=(l,a,b)=>{const t=new Date(l.start_at).getTime(); return t>=a.getTime()&&t<b.getTime();};
    const cur=lessons.filter(l=>inR(l,thisStart,nextStart)).length;
    const prev=lessons.filter(l=>inR(l,prevStart,thisStart)).length;
    const upcoming=lessons.filter(l=>l.status==='예약'&&new Date(l.start_at).getTime()>=Date.now()).length;
    return {cur,prev,upcoming,thisStart,nextStart};
  })();

  // 이탈 위험 (PushPress 무출석 감지 + Zen Planner 출석급감 레드플래그)
  // 활성 회차권(PT) 보유 회원 중: 예정 예약 없음 + 최근 14일 완료수업 0건 = 무출석 / 이전 4주 평균 대비 절반 이하 = 급감
  const risk=(()=>{
    const now=Date.now(), d14=now-14*86400000, d42=now-42*86400000;
    const liveStart={};
    (ms||[]).forEach(m=>{ if(m.status!=='활성'||!(m.total_count>0)) return;
      const s=m.start_date||''; if(!(m.member_id in liveStart)||s<liveStart[m.member_id]) liveStart[m.member_id]=s; });
    const stat={};
    (lessons||[]).forEach(l=>{
      const ts=new Date(l.start_at).getTime(); if(isNaN(ts)) return;
      const o=stat[l.member_id]||(stat[l.member_id]={last:0,recent14:0,prev28:0,future:0});
      if(l.status==='예약'&&ts>now){ o.future++; return; }
      if(l.status!=='완료') return;
      if(ts>o.last) o.last=ts;
      if(ts>=d14) o.recent14++; else if(ts>=d42) o.prev28++;
    });
    const grace=ymd(new Date(now-14*86400000));
    const out=[];
    Object.keys(liveStart).forEach(id=>{
      if(!memById[id]) return;                    // RLS로 안 보이는 회원 제외
      if((liveStart[id]||'')>grace) return;       // 등록 14일 미만 신규는 유예
      const o=stat[id]||{last:0,recent14:0,prev28:0,future:0};
      if(o.future>0) return;                      // 예정된 예약이 있으면 안심
      if(o.recent14===0){
        const days=o.last?Math.floor((now-o.last)/86400000):null;
        out.push({id,type:'none',days,sort:(days==null?999:days)});
      }else{
        const avg14=o.prev28/2;
        if(avg14>=2 && o.recent14<=avg14*0.5) out.push({id,type:'drop',recent14:o.recent14,avg14,sort:0});
      }
    });
    return out.sort((a,b)=>((b.type==='none')-(a.type==='none'))||b.sort-a.sort);
  })();

  // ★입력이 끊기면 이탈 위험은 통째로 거짓 경보가 된다.
  //   이탈 위험은 "최근 14일 완료 수업 0건"으로 잡는데, 주간 스케줄을 등록하지 않으면
  //   잘 다니는 회원까지 전부 걸린다. 2026-07-31 실측으로 모수의 71%가 위험으로 떴다.
  //   ★판정 기준 주의: 처음엔 "마지막 수업이 7일 이상 지났는가"로 잡았는데 안 걸렸다.
  //     띄엄띄엄이라도 몇 건은 들어오기 때문이다(당시 마지막 수업 5일 전, 그런데도 43명 위험).
  //     실제 신호는 날짜가 아니라 **비율** — 위험군이 모수의 절반을 넘으면 회원 문제가 아니라 데이터 문제다.
  const riskBase=(()=>{
    const grace=ymd(new Date(Date.now()-14*86400000));
    const start={};
    (ms||[]).forEach(m=>{ if(m.status!=='활성'||!(m.total_count>0)) return;
      const s=m.start_date||''; if(!(m.member_id in start)||s<start[m.member_id]) start[m.member_id]=s; });
    return Object.keys(start).filter(id=>memById[id] && !((start[id]||'')>grace)).length;
  })();
  const riskRatio = riskBase>0 ? risk.length/riskBase : 0;
  const feedStale = lastLessonAgo===null || riskRatio>=0.5;

  // 활성 회원 성별비 / 연령대 (브로제이 인사이트 대응)
  const actives=(members||[]).filter(m=>m.status==='활성');
  const genderCnt={남성:0,여성:0,미입력:0};
  actives.forEach(m=>{ genderCnt[m.gender==='남성'||m.gender==='여성'?m.gender:'미입력']++; });
  const ageBuckets={}; let ageNone=0;
  actives.forEach(m=>{ if(!m.birth||isNaN(new Date(m.birth))){ ageNone++; return; }
    const a=Math.floor((Date.now()-new Date(m.birth))/31557600000); const b=Math.min(70,Math.max(0,Math.floor(a/10)*10));
    ageBuckets[b]=(ageBuckets[b]||0)+1; });
  const maxAge=Math.max(1,...Object.values(ageBuckets),1);
  const unpaidTotal=unpaid.reduce((s,m)=>s+(m.unpaid||0),0);
  const mmdd=s=>{ if(!s)return ''; const d=new Date(s); return isNaN(d)?'':pad(d.getMonth()+1)+pad(d.getDate()); };
  const todayMD=pad(today.getMonth()+1)+pad(today.getDate());
  const birthdays=(members||[]).filter(m=>mmdd(m.birth)===todayMD);
  const counts={전체:(members||[]).length,활성:0};
  (members||[]).forEach(m=>{ if(m.status==='활성')counts.활성++; });
  const nm=id=>(memById[id]&&memById[id].name)||'-';
  const openMember=id=>{ const m=memById[id]; if(m) setSel(m); };
  // B1: 위젯 행에서 바로 팔로업 할일 만들기 (회원 열지 않고 원클릭)
  const TaskBtn=({mid,title})=> memById[mid] ? <button className="taskmini" title="이 회원 팔로업 할일 추가"
    onClick={e=>{e.stopPropagation(); setTaskFor({member:memById[mid],initTitle:title});}}>＋할일</button> : null;
  const dsb=useDaysSinceBackup(sb);
  const hcBad=useHealthAlert(sb,role);
  // 조회 실패는 숫자를 0으로 보여주는 대신 이유를 말해준다.
  // 세션 만료(JWT/PGRST303)면 다시 로그인해야 풀리므로 그렇게 안내한다.
  if(loadErr){
    const expired=/JWT|PGRST303|expired|refresh/i.test(loadErr);
    return (<div className="empty" style={{textAlign:'left',maxWidth:560,margin:'40px auto',lineHeight:1.7}}>
      <div style={{fontSize:34,marginBottom:10,textAlign:'center'}}>⚠️</div>
      <b style={{display:'block',textAlign:'center',marginBottom:10,color:'var(--cream)'}}>
        {expired?'로그인이 만료되어 데이터를 불러오지 못했습니다':'데이터를 불러오지 못했습니다'}</b>
      <div className="muted" style={{fontSize:13}}>
        {expired
          ? '데이터는 그대로 있습니다. 다시 로그인하면 정상으로 돌아옵니다.'
          : '네트워크 상태를 확인하고 다시 시도해주세요. 화면의 숫자가 0으로 보이는 것을 막기 위해 표시를 멈췄습니다.'}
        <div style={{marginTop:8,fontSize:12,opacity:.75}}>{loadErr}</div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'center'}}>
        <button className="btn" onClick={()=>{setLoadErr('');load();}}>다시 시도</button>
        {expired && <button className="btn ghost" onClick={()=>sb.auth.signOut()}>다시 로그인</button>}
      </div>
    </div>);
  }
  if(members===null) return <div className="empty">불러오는 중...</div>;
  return (<div>
    {hcBad && hcBad.length>0 && <div className="backup-remind"
        style={{cursor:'pointer',background:'rgba(217,139,122,.12)',borderColor:'rgba(217,139,122,.4)',color:'#e3a091'}}
        onClick={()=>onNav&&onNav('logs')}>
      <span>🩺 데이터 이상 {hcBad.length}건이 발견됐습니다 — {hcBad.map(c=>`${c.label} ${c.n}건`).join(' · ')}</span>
      <button className="btn sm" onClick={e=>{e.stopPropagation(); onNav&&onNav('logs');}}>자가진단 보기 →</button>
    </div>}
    {can('logs') && (dsb===null||dsb>=7) && <div className="backup-remind" onClick={()=>onNav&&onNav('logs')} style={{cursor:'pointer'}}>
      <span>💾 {dsb===null?'데이터를 아직 파일로 백업한 적이 없어요.':`마지막 파일 백업이 ${dsb}일 전이에요.`} 사고에 대비해 파일 백업을 PC에 보관하세요.</span>
      <button className="btn sm" onClick={e=>{e.stopPropagation(); onNav&&onNav('logs');}}>백업하러 가기 →</button>
    </div>}
    <div className="stats">
      <div className="stat"><div className="n">{counts.전체}</div><div className="l">전체 회원</div></div>
      <div className="stat"><div className="n" style={{color:'#7dc4a0'}}>{counts.활성}</div><div className="l">활성 회원</div></div>
      <div className="stat"><div className="n" style={{color:'var(--brass)'}}>{soon.length}</div><div className="l">만료 임박 (14일)</div></div>
      {can('sales') && <div className="stat"><div className="n" style={{color:unpaidTotal>0?'#d98b7a':'var(--muted)'}}>{unpaidTotal.toLocaleString()}<span style={{fontSize:14,fontWeight:600}}>원</span></div><div className="l">미수금 총액</div></div>}
    </div>
    <div className="dash-grid">
      <div className="mp-cardbox">
        <h3><span>✅ 할 일</span>
          <span style={{display:'flex',gap:8,alignItems:'center'}}>
            {Array.isArray(tasks) && <span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{tasks.length}건</span>}
            <button className="btn ghost sm" onClick={()=>setTaskModal(true)}>＋ 추가</button>
          </span></h3>
        {tasks===null? <div className="muted">불러오는 중...</div> :
          tasks==='na'? <div className="muted">할일 기능을 사용하려면 db/notes_tasks.sql을 Supabase SQL 에디터에서 실행하세요.</div> :
          tasks.length===0? <div className="muted">열려있는 할 일이 없습니다<br/><span style={{fontSize:12}}>(회원 상세의 노트에서, 또는 ＋ 추가로 만들 수 있습니다)</span></div> :
          tasks.slice(0,15).map(t=>{ const d=t.due_date?dday(t.due_date):null;
            return (<div className="dash-row" key={t.id} style={{cursor:t.member_id?'pointer':'default'}} onClick={()=>{ if(t.member_id) openMember(t.member_id); }}>
              <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
                <input type="checkbox" className="task-chk" title="완료 처리" onClick={e=>e.stopPropagation()} onChange={()=>completeTask(t)}/>
                <div style={{minWidth:0}}>
                  <b style={{display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</b>
                  <span className="muted" style={{fontSize:12}}>{t.member_id&&nm(t.member_id)!=='-'?nm(t.member_id)+' · ':''}{t.assignee||'-'}</span>
                </div>
              </div>
              {d!=null && <span className={'dday'+(d<0?' expired':'')}>{d<0?`${-d}일 지남`:d===0?'오늘':'D-'+d}</span>}
            </div>); })}
      </div>
      <div className="mp-cardbox">
        <h3><span>📅 주간 스케줄 등록</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>
          앞으로 예정 {weekStat.upcoming}건</span></h3>
        <div className="kv" style={{marginBottom:4}}><span>이번 주 등록</span><b style={{color:weekStat.cur===0?'#d98b7a':'var(--cream)'}}>{weekStat.cur}건</b></div>
        <div className="kv"><span>지난 주</span><b className="muted">{weekStat.prev}건</b></div>
        {weekStat.upcoming===0 && <p className="muted" style={{fontSize:12,margin:'10px 0 0'}}>
          앞으로 예정된 수업이 하나도 없습니다. 주간 스케줄을 등록하면 이탈 위험·출석 통계가 다시 정확해집니다.</p>}
        <div style={{marginTop:10}}>
          <button className="btn sm" onClick={()=>onNav&&onNav('calendar')}>주간 스케줄 등록하러 가기 →</button>
        </div>
      </div>
      <div className="mp-cardbox">
        <h3><span>🚨 이탈 위험</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{feedStale?'집계 보류':risk.length+'명'}</span></h3>
        {feedStale? <div className="muted">
            {lastLessonAgo===null? '등록된 수업이 없어 이탈 위험을 계산할 수 없습니다.'
              : `대상 ${riskBase}명 중 ${risk.length}명(${Math.round(riskRatio*100)}%)이 위험으로 잡혔습니다 — 실제 이탈이 아니라 수업이 등록되지 않은 것입니다.`}
            <br/><span style={{fontSize:12}}>이 상태에서는 잘 다니는 회원까지 위험으로 잡히므로 목록을 감췄습니다. 주간 스케줄을 등록하면 다시 계산됩니다.</span>
            <div style={{marginTop:10}}><button className="btn sm" onClick={()=>onNav&&onNav('calendar')}>캘린더로 이동 →</button></div>
          </div> :
          risk.length===0? <div className="muted">이탈 위험 신호가 없습니다<br/><span style={{fontSize:12}}>(활성 회차권 보유 회원 중 예정 예약 없이 2주간 수업이 없거나 급감하면 표시됩니다)</span></div> :
          risk.slice(0,15).map(r=>{ const m=memById[r.id]; return (
            <div className="dash-row" key={r.id} onClick={()=>openMember(r.id)}>
              <div><b>{m.name}</b> <span className="muted" style={{fontSize:13}}>· {m.assigned_trainer||'담당 미지정'}</span></div>
              <span className="dash-rt">
                {r.type==='none'
                  ? <span style={{color:'#d98b7a',fontWeight:700,fontSize:13}}>{r.days==null?'6주+':r.days+'일'} 무출석</span>
                  : <span style={{color:'#e0a23c',fontWeight:700,fontSize:13}}>급감 · 2주 {r.recent14}회 (평소 {Math.round(r.avg14)}회)</span>}
                <TaskBtn mid={r.id} title={`${m.name} 이탈 위험 — 연락`}/>
              </span>
            </div>); })}
        {risk.length>0 && <p className="muted" style={{fontSize:12,margin:'8px 0 0'}}>예정된 예약 없이 수업이 끊긴 회원입니다. 연락해 보세요.</p>}
      </div>
      <div className="mp-cardbox">
        <h3><span>⏰ 만료 임박</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{soon.length}건</span></h3>
        {soon.length===0? <div className="muted">14일 내 만료 예정인 회원권이 없습니다</div> :
          soon.slice(0,15).map(({m,d})=>(<div className="dash-row" key={m.id} onClick={()=>openMember(m.member_id)}>
            <div><b>{nm(m.member_id)}</b> <span className="muted" style={{fontSize:13}}>· {m.product_name} · ~{fmtDate(m.end_date)}</span></div>
            <span className="dash-rt"><span className={'dday'+(d<=3?' expired':'')}>{d===0?'오늘 만료':'D-'+d}</span>
              <TaskBtn mid={m.member_id} title={`${nm(m.member_id)} 재등록 상담 (만료 ${fmtDate(m.end_date)})`}/></span>
          </div>))}
      </div>
      {can('sales') && <div className="mp-cardbox">
        <h3><span>💰 미수금</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{unpaid.length}명 · {unpaidTotal.toLocaleString()}원</span></h3>
        {unpaid.length===0? <div className="muted">미수금이 없습니다</div> :
          unpaid.slice(0,15).map(m=>(<div className="dash-row" key={m.id} onClick={()=>openMember(m.member_id)}>
            <div><b>{nm(m.member_id)}</b> <span className="muted" style={{fontSize:13}}>· {m.product_name}</span></div>
            <span className="dash-rt"><span style={{color:'#d98b7a',fontWeight:700}}>{m.unpaid.toLocaleString()}원</span>
              <TaskBtn mid={m.member_id} title={`${nm(m.member_id)} 미수금 ${m.unpaid.toLocaleString()}원 수납 안내`}/></span>
          </div>))}
      </div>}
      <div className="mp-cardbox">
        <h3><span>🎂 오늘 생일</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{birthdays.length}명</span></h3>
        {birthdays.length===0? <div className="muted">오늘 생일인 회원이 없습니다
            {noBirth>0 && <><br/><span style={{fontSize:12}}>※ 생년월일이 없는 회원이 {noBirth}명({Math.round(noBirth/Math.max(1,(members||[]).length)*100)}%)이라 실제 생일을 놓칠 수 있습니다.</span></>}
          </div> :
          birthdays.map(m=>(<div className="dash-row" key={m.id} onClick={()=>openMember(m.id)}>
            <div><b>{m.name}</b> <span className="muted" style={{fontSize:13}}>· {m.phone||''}</span></div>
            <span className="muted">{age(m.birth)}</span>
          </div>))}
      </div>
      <div className="mp-cardbox">
        <h3><span>⏸ 홀딩중</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{holding.length}건</span></h3>
        {holding.length===0? <div className="muted">홀딩중인 회원권이 없습니다</div> :
          holding.slice(0,15).map(m=>(<div className="dash-row" key={m.id} onClick={()=>openMember(m.member_id)}>
            <div><b>{nm(m.member_id)}</b> <span className="muted" style={{fontSize:13}}>· {m.product_name}</span></div>
            <span className="muted" style={{fontSize:13}}>{m.hold_start?fmtDate(m.hold_start)+'부터':''}</span>
          </div>))}
      </div>
      <div className="mp-cardbox">
        <h3><span>🔻 잔여횟수 임박</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>3회 이하 · {lowCount.length}건</span></h3>
        {lowCount.length===0? <div className="muted">잔여 3회 이하인 회원권이 없습니다</div> :
          lowCount.slice(0,15).map(m=>(<div className="dash-row" key={m.id} onClick={()=>openMember(m.member_id)}>
            <div><b>{nm(m.member_id)}</b> <span className="muted" style={{fontSize:13}}>· {m.product_name}{m.trainer?` · ${m.trainer}`:''}</span></div>
            <span className="dash-rt"><span style={{color:(m.remaining_count||0)===0?'#d98b7a':'#e0a23c',fontWeight:700}}>잔여 {m.remaining_count||0}/{m.total_count}</span>
              <TaskBtn mid={m.member_id} title={`${nm(m.member_id)} 재등록 상담 (잔여 ${m.remaining_count||0}회)`}/></span>
          </div>))}
        {lowCount.length>0 && <p className="muted" style={{fontSize:12,margin:'8px 0 0'}}>재등록 안내가 필요한 회원입니다.</p>}
      </div>
      <div className="mp-cardbox">
        <h3><span>🚪 최근 만료 · 미재등록</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>30일 내 · {churn.length}명</span></h3>
        {churn.length===0? <div className="muted">최근 30일 내 만료 후 미재등록 회원이 없습니다<br/><span style={{fontSize:12}}>(앞으로 회원권이 만료되면 여기에 표시됩니다)</span></div> :
          churn.slice(0,15).map(m=>(<div className="dash-row" key={m.id} onClick={()=>openMember(m.member_id)}>
            <div><b>{nm(m.member_id)}</b> <span className="muted" style={{fontSize:13}}>· {m.product_name}</span></div>
            <span className="dash-rt"><span className="muted" style={{fontSize:13}}>{fmtDate(m.end_date)} 만료</span>
              <TaskBtn mid={m.member_id} title={`${nm(m.member_id)} 재등록 권유 (${fmtDate(m.end_date)} 만료)`}/></span>
          </div>))}
      </div>
      {can('lockers') && <div className="mp-cardbox">
        <h3><span>🔑 락커 만료 · 임박</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>
          {lkOver.length>0? `만료 ${lkOver.length} · 임박 ${lkSoon.length-lkOver.length}` : `14일 내 · ${lkSoon.length}건`}</span></h3>
        {lkSoon.length===0? <div className="muted">만료됐거나 14일 내 만료될 락커가 없습니다</div> :
          lkSoon.slice(0,15).map(({l,d})=>(<div className="dash-row" key={l.id} onClick={()=>openMember(l.member_id)}>
            <div><b>{l.number}번</b> <span className="muted" style={{fontSize:13}}>· {nm(l.member_id)||'(회원 없음)'}</span></div>
            <span className="dash-rt"><span className={'dday'+(d<0?' expired':'')}>{d<0?`${-d}일 지남`:(d===0?'오늘 만료':'D-'+d)}</span>
              <TaskBtn mid={l.member_id} title={`${nm(l.member_id)} 락커 ${l.number}번 ${d<0?'회수·연장 확인':'연장 안내'} (${fmtDate(l.end_date)} 만료)`}/></span>
          </div>))}
        {lkOver.length>0 && <p className="muted" style={{fontSize:12,margin:'8px 0 0'}}>
          만료된 칸은 실물에 짐이 남았는지 먼저 확인하세요. 회수하면 비어있는 락커로 잡힙니다.</p>}
      </div>}
      <div className="mp-cardbox">
        <h3><span>📊 활성 회원 분포</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{actives.length}명</span></h3>
        {actives.length===0? <div className="muted">활성 회원이 없습니다</div> : <>
          <div className="kv" style={{marginBottom:6}}><span>성별</span>
            <b>남 {genderCnt.남성} · 여 {genderCnt.여성}{genderCnt.미입력?` · 미입력 ${genderCnt.미입력}`:''}</b></div>
          <div style={{display:'flex',height:8,borderRadius:6,overflow:'hidden',background:'#0a120f',marginBottom:12}}>
            {genderCnt.남성>0 && <i style={{flex:genderCnt.남성,background:'#2e6da4'}}/>}
            {genderCnt.여성>0 && <i style={{flex:genderCnt.여성,background:'#b5417a'}}/>}
            {genderCnt.미입력>0 && <i style={{flex:genderCnt.미입력,background:'#3a4b44'}}/>}
          </div>
          {Object.keys(ageBuckets).sort((a,b)=>a-b).map(b=>(
            <div key={b} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,padding:'2px 0'}}>
              <span className="muted" style={{width:46}}>{b==='0'?'10세↓':b+'대'}</span>
              <div style={{flex:1,height:7,background:'#0a120f',borderRadius:5,overflow:'hidden'}}><i style={{display:'block',height:'100%',width:(ageBuckets[b]/maxAge*100)+'%',background:'var(--brass)'}}/></div>
              <b style={{width:26,textAlign:'right'}}>{ageBuckets[b]}</b>
            </div>))}
          {ageNone>0 && <div className="muted" style={{fontSize:12,marginTop:4}}>생년월일 미입력 {ageNone}명</div>}
        </>}
      </div>
    </div>
    {/* 로그아웃은 화면 맨 아래에 둔다 — 실수로 눌리지 않게(모바일 전용, 데스크탑은 사이드바에 있음) */}
    {onLogout && <div className="home-logout">
      <button className="btn ghost" onClick={()=>{ if(confirm('로그아웃할까요?')) onLogout(); }}>로그아웃</button>
    </div>}
    {sel && <Detail sb={sb} member={sel} onClose={()=>{setSel(null);load();}}/>}
    {taskModal && <TaskModal sb={sb} member={null} onClose={()=>setTaskModal(false)} onSaved={()=>{setTaskModal(false);load();}}/>}
    {taskFor && <TaskModal sb={sb} member={taskFor.member} initTitle={taskFor.initTitle} onClose={()=>setTaskFor(null)} onSaved={()=>{setTaskFor(null);load();}}/>}
  </div>);
}

// ---------- 매출 ----------
function SalesView({sb}){
  const {role}=usePerm();
  const [pays,setPays]=useState(null);
  const [members,setMembers]=useState([]);
  const [unpaidSum,setUnpaidSum]=useState(0);
  const [ref,setRef]=useState(()=>{const d=new Date();return {y:d.getFullYear(),m:d.getMonth()};});
  const [msAll,setMsAll]=useState([]);
  const [mode,setMode]=useState('month'); // month=월별 상세 / report=경영 리포트
  const [rates,setRates]=useState({});   // 강사별 정산율% (trainer_rates, 마스터 전용)
  const rateTimer=useRef({});
  useEffect(()=>{
    fetchAll(()=>sb.from('payments').select('*').order('paid_at',{ascending:false}).order('id')).then(({data})=>setPays(data||[]));
    fetchAll(()=>sb.from('members').select('id,name').order('id')).then(({data})=>setMembers(data||[]));
    fetchAll(()=>sb.from('memberships').select('id,member_id,unpaid,trainer,status,start_date,end_date').order('id')).then(({data})=>{ setMsAll(data||[]); setUnpaidSum((data||[]).reduce((s,m)=>s+(m.unpaid||0),0)); });
    if(role==='master') sb.from('trainer_rates').select('*').then(({data})=>{ const o={}; (data||[]).forEach(r=>o[r.name]=r.rate); setRates(o); });
  },[]);
  function setRate(name,v){
    const rate=Math.max(0,Math.min(100,parseInt(String(v).replace(/\D/g,''))||0));
    setRates(p=>({...p,[name]:rate}));
    clearTimeout(rateTimer.current[name]);
    rateTimer.current[name]=setTimeout(async()=>{
      const {error}=await sb.from('trainer_rates').upsert({name,rate,updated_at:new Date().toISOString()});
      if(error) alert('정산율 저장 실패: '+error.message+(/does not exist|schema cache/i.test(error.message)?' (db/tags_payroll_consent.sql 실행 필요)':''));
    },600);
  }
  const [monthLessons,setMonthLessons]=useState([]);
  useEffect(()=>{ const s=new Date(ref.y,ref.m,1), e=new Date(ref.y,ref.m+1,1);
    sb.from('lessons').select('trainer,status,member_id').gte('start_at',s.toISOString()).lt('start_at',e.toISOString()).then(({data})=>setMonthLessons(data||[])); },[ref]);
  const nameById=useMemo(()=>{const o={};members.forEach(x=>o[x.id]=x.name);return o;},[members]);
  // 회원별 회원권 회차(등록순): membership_id → N회차
  const rankByMs=useMemo(()=>{ const by={}; msAll.slice().sort((a,b)=>a.id-b.id).forEach(m=>{ (by[m.member_id]=by[m.member_id]||[]).push(m.id); }); const r={}; Object.values(by).forEach(list=>list.forEach((id,i)=>r[id]=i+1)); return r; },[msAll]);
  const regLabel=p=>{ if((p.amount||0)<0||p.method==='환불') return '환불'; if(p.method==='미수금수납') return '미수금'; const rk=p.membership_id?rankByMs[p.membership_id]:null; if(!rk) return '-'; return rk===1?'신규':`재등록(${rk}회차)`; };
  const ym=`${ref.y}-${pad(ref.m+1)}`;
  const monthPays=(pays||[]).filter(p=>(p.paid_at||'').slice(0,7)===ym);
  const total=monthPays.reduce((s,p)=>s+(p.amount||0),0);
  const salesSum=monthPays.filter(p=>(p.amount||0)>0).reduce((s,p)=>s+p.amount,0);
  const refundSum=monthPays.filter(p=>(p.amount||0)<0).reduce((s,p)=>s+p.amount,0);
  const count=monthPays.length;
  const avg=count?Math.round(total/count):0;
  const allTotal=(pays||[]).reduce((s,p)=>s+(p.amount||0),0);
  const daysInMonth=new Date(ref.y,ref.m+1,0).getDate();
  const byDay=Array.from({length:daysInMonth},()=>0);
  monthPays.forEach(p=>{const d=parseInt((p.paid_at||'').slice(8,10)); if(d>=1&&d<=daysInMonth)byDay[d-1]+=(p.amount||0);});
  const maxDay=Math.max(1,...byDay);
  const byMethod={}; monthPays.forEach(p=>{const k=p.pay_method||'미지정'; byMethod[k]=(byMethod[k]||0)+(p.amount||0);});
  function exportCSV(){
    const rows=[['거래일','회원','구분','등록구분','결제수단','금액']];
    monthPays.forEach(p=>rows.push([fmtDate(p.paid_at),nameById[p.member_id]||'',p.method||'',regLabel(p),p.pay_method||'',p.amount||0]));
    downloadCSV(`매출_${ym}.csv`,rows);
  }
  function move(delta){ setRef(r=>{ let m=r.m+delta,y=r.y; if(m<0){m=11;y--;} if(m>11){m=0;y++;} return {y,m}; }); }
  // 강사별 실적: 해당월 수업(상태별) + 수업회원수 + 매출기여(결제→회원권 trainer 기준)
  const trainerByMs=useMemo(()=>{ const o={}; msAll.forEach(m=>o[m.id]=m.trainer||null); return o; },[msAll]);
  const trainerStats=useMemo(()=>{ const st={};
    const get=t=>st[t]=st[t]||{done:0,noshow:0,rest:0,booked:0,members:new Set(),revenue:0};
    monthLessons.forEach(l=>{ const s=get(l.trainer||'미지정');
      if(l.status==='완료')s.done++; else if(l.status==='노쇼')s.noshow++; else if(l.status==='휴강')s.rest++; else s.booked++;
      if(l.member_id)s.members.add(l.member_id); });
    monthPays.forEach(p=>{ if(!p.membership_id)return; const t=trainerByMs[p.membership_id]; if(t) get(t).revenue+=(p.amount||0); });
    return Object.entries(st).sort((a,b)=>(b[1].done+b[1].booked)-(a[1].done+a[1].booked)); },[monthLessons,monthPays,trainerByMs]);
  // ---- 경영 리포트: 최근 12개월 매출추이 + 신규/재등록 + 재등록률 코호트 ----
  const report=useMemo(()=>{
    if(!pays) return null;
    const now=new Date();
    const months=[]; for(let i=11;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}`); }
    const mset=new Set(months);
    const by={}; months.forEach(m=>by[m]={total:0,cnt:0,nw:0,re:0});
    pays.forEach(p=>{ const m=(p.paid_at||'').slice(0,7); if(!mset.has(m)) return; const o=by[m];
      o.total+=(p.amount||0); o.cnt++;
      if((p.amount||0)>0 && p.membership_id && p.method!=='미수금수납'){ const rk=rankByMs[p.membership_id]; if(rk===1)o.nw++; else if(rk>1)o.re++; } });
    // 재등록률: 만료월 코호트(최근 6개월) — 만료 후 90일 내 새 회원권 시작 여부
    const byMember={}; msAll.forEach(m=>{ (byMember[m.member_id]=byMember[m.member_id]||[]).push(m); });
    const cohorts=[];
    for(let i=6;i>=1;i--){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1); const ym=`${d.getFullYear()}-${pad(d.getMonth()+1)}`;
      const expired={};
      msAll.forEach(m=>{ if(m.status!=='만료'||!(m.end_date||'').startsWith(ym)) return;
        if(!expired[m.member_id]||m.end_date>expired[m.member_id]) expired[m.member_id]=m.end_date; });
      let tot=0,re=0,open=false;
      Object.entries(expired).forEach(([mid,ed])=>{
        const lim=new Date(ed); lim.setDate(lim.getDate()+90); if(lim>now) open=true;
        const limS=ymd(lim);
        const rereg=(byMember[mid]||[]).some(x=>x.start_date && x.start_date>ed && x.start_date<=limS);
        tot++; if(rereg) re++;
      });
      cohorts.push({ym,tot,re,open});
    }
    const cohortTot=cohorts.reduce((s,c)=>s+c.tot,0), cohortRe=cohorts.reduce((s,c)=>s+c.re,0);
    const total12=months.reduce((s,m)=>s+by[m].total,0);
    const activeMonths=months.filter(m=>by[m].total!==0).length||1;
    const maxM=Math.max(1,...months.map(m=>by[m].total));
    return {months,by,cohorts,total12,avg:Math.round(total12/activeMonths),cohortTot,cohortRe,maxM};
  },[pays,msAll,rankByMs]);
  return (<div>
    <div className="seg" style={{display:'inline-flex',marginBottom:14}}>
      <button className={mode==='month'?'on':''} onClick={()=>setMode('month')}>월별 상세</button>
      <button className={mode==='report'?'on':''} onClick={()=>setMode('report')}>📊 경영 리포트</button>
    </div>
    {mode==='report' && (report===null? <div className="empty">불러오는 중...</div> : <>
      <div className="stats">
        <div className="stat"><div className="n" style={{color:'var(--brass)'}}>{report.total12.toLocaleString()}<span style={{fontSize:15,fontWeight:600}}>원</span></div><div className="l">최근 12개월 매출</div></div>
        <div className="stat"><div className="n">{report.avg.toLocaleString()}<span style={{fontSize:15,fontWeight:600}}>원</span></div><div className="l">월평균 매출 (매출 있는 달 기준)</div></div>
        <div className="stat"><div className="n" style={{color:report.cohortTot?'#7dc4a0':'var(--muted)'}}>{report.cohortTot?Math.round(report.cohortRe/report.cohortTot*100)+'%':'-'}</div><div className="l">재등록률 (최근 6개월 만료 {report.cohortTot}명)</div></div>
        <div className="stat"><div className="n">{(()=>{const o=report.by[report.months[11]];return o.nw+o.re;})()}<span style={{fontSize:15,fontWeight:600}}>건</span></div><div className="l">이번달 등록 (신규+재등록)</div></div>
      </div>
      <div className="mp-cardbox" style={{marginBottom:16}}>
        <h3><span>월별 매출 추이 · 최근 12개월</span></h3>
        <div className="saleschart">
          {report.months.map(m=>{const v=report.by[m].total; return <div key={m} className="bar" style={{height:Math.max(2,Math.abs(v)/report.maxM*100)+'%',opacity:v?1:.2}} title={`${m} · ${v.toLocaleString()}원`}/>;})}
        </div>
        <div className="saleschart-x">{report.months.map(m=><span key={m}>{parseInt(m.slice(5))}월</span>)}</div>
      </div>
      <div className="mp-cardbox" style={{marginBottom:16}}>
        <h3><span>월별 등록 현황 · 최근 6개월</span></h3>
        <table className="ptable"><thead><tr><th>월</th><th style={{textAlign:'right'}}>매출</th><th style={{textAlign:'right'}}>결제 건수</th><th style={{textAlign:'right'}}>신규</th><th style={{textAlign:'right'}}>재등록</th></tr></thead>
          <tbody>{report.months.slice(6).map(m=>{const o=report.by[m]; return (<tr key={m}>
            <td style={{fontWeight:700}}>{m.slice(0,4)}.{m.slice(5)}</td>
            <td style={{textAlign:'right'}}>{o.total.toLocaleString()}원</td>
            <td style={{textAlign:'right'}}>{o.cnt}</td>
            <td style={{textAlign:'right',color:o.nw?'#7dc4a0':undefined}}>{o.nw}</td>
            <td style={{textAlign:'right'}}>{o.re}</td>
          </tr>);})}</tbody></table>
      </div>
      <div className="mp-cardbox">
        <h3><span>재등록률 · 만료월 코호트</span></h3>
        {report.cohortTot===0? <div className="muted">최근 6개월 내 만료된 회원권이 없습니다</div> :
        <table className="ptable"><thead><tr><th>만료월</th><th style={{textAlign:'right'}}>만료 회원</th><th style={{textAlign:'right'}}>재등록</th><th style={{textAlign:'right'}}>재등록률</th></tr></thead>
          <tbody>{report.cohorts.map(c=>(<tr key={c.ym}>
            <td style={{fontWeight:700}}>{c.ym.slice(0,4)}.{c.ym.slice(5)}{c.open?<span className="muted" style={{fontSize:11,marginLeft:6}}>집계중</span>:null}</td>
            <td style={{textAlign:'right'}}>{c.tot}명</td>
            <td style={{textAlign:'right'}}>{c.re}명</td>
            <td style={{textAlign:'right',fontWeight:700,color:c.tot&&c.re/c.tot>=0.5?'#7dc4a0':undefined}}>{c.tot?Math.round(c.re/c.tot*100)+'%':'-'}</td>
          </tr>))}</tbody></table>}
        <p className="muted" style={{fontSize:12,margin:'8px 0 0'}}>만료 회원권 기준, 만료 후 90일 내 새 회원권 시작 시 재등록으로 집계. '집계중'=아직 90일 미경과.</p>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:14}}>※ 앱에 기록된 결제·회원권만 집계됩니다. 브로제이 과거 매출·만료 이력은 반영되지 않아 초기 수치는 보수적으로 나옵니다.</p>
    </>)}
    {mode==='month' && <>
    <div className="sales-nav">
      <button onClick={()=>move(-1)}>← 이전달</button>
      <div className="per">{ref.y}년 {ref.m+1}월</div>
      <button onClick={()=>move(1)}>다음달 →</button>
    </div>
    <div className="stats">
      <div className="stat"><div className="n" style={{color:'var(--brass)'}}>{total.toLocaleString()}<span style={{fontSize:15,fontWeight:600}}>원</span></div><div className="l">{ref.m+1}월 매출{refundSum<0?` (판매 ${salesSum.toLocaleString()} · 환불 ${refundSum.toLocaleString()})`:''}</div></div>
      <div className="stat"><div className="n">{count}<span style={{fontSize:15,fontWeight:600}}>건</span></div><div className="l">결제 건수</div></div>
      <div className="stat"><div className="n">{avg.toLocaleString()}<span style={{fontSize:15,fontWeight:600}}>원</span></div><div className="l">건당 평균</div></div>
      <div className="stat"><div className="n muted">{allTotal.toLocaleString()}<span style={{fontSize:15,fontWeight:600}}>원</span></div><div className="l">누적 총매출</div></div>
      <div className="stat"><div className="n" style={{color:unpaidSum>0?'#d98b7a':'var(--muted)'}}>{unpaidSum.toLocaleString()}<span style={{fontSize:15,fontWeight:600}}>원</span></div><div className="l">미수금 총액</div></div>
    </div>
    {total>0 && <div className="muted" style={{fontSize:13,margin:'0 0 14px'}}>결제수단 · {Object.entries(byMethod).map(([k,v])=>`${k} ${v.toLocaleString()}원`).join('  ·  ')}</div>}
    <div className="mp-cardbox" style={{marginBottom:16}}>
      <h3><span>일별 매출 · {ref.m+1}월</span></h3>
      {pays===null? <div className="muted">불러오는 중...</div> :
        total===0? <div className="muted" style={{padding:'24px 0',textAlign:'center'}}>{ref.m+1}월 결제 내역이 없습니다</div> :
        <><div className="saleschart">
          {byDay.map((v,i)=><div key={i} className="bar" style={{height:Math.max(2,v/maxDay*100)+'%',opacity:v?1:.2}} title={`${i+1}일 · ${v.toLocaleString()}원`}/>)}
        </div>
        <div className="saleschart-x">{byDay.map((v,i)=><span key={i}>{(i+1)%5===0||i===0?i+1:''}</span>)}</div></>}
    </div>
    <div className="mp-cardbox" style={{marginBottom:16}}>
      <h3><span>강사별 실적 · {ref.m+1}월</span></h3>
      {trainerStats.length===0? <div className="muted">{ref.m+1}월 수업 기록이 없습니다</div> :
        <table className="ptable"><thead><tr><th>강사</th><th style={{textAlign:'right'}}>완료</th><th style={{textAlign:'right'}}>예정</th><th style={{textAlign:'right'}}>노쇼</th><th style={{textAlign:'right'}}>휴강</th><th style={{textAlign:'right'}}>수업회원</th><th style={{textAlign:'right'}}>매출 기여</th>{role==='master' && <><th style={{textAlign:'right'}}>정산율</th><th style={{textAlign:'right'}}>정산액</th></>}</tr></thead>
          <tbody>{trainerStats.map(([t,s])=>(<tr key={t}>
            <td style={{fontWeight:700}}>{t}</td>
            <td style={{textAlign:'right'}}>{s.done}</td>
            <td style={{textAlign:'right'}}>{s.booked}</td>
            <td style={{textAlign:'right',color:s.noshow?'#d98b7a':undefined}}>{s.noshow}</td>
            <td style={{textAlign:'right'}}>{s.rest}</td>
            <td style={{textAlign:'right'}}>{s.members.size}명</td>
            <td style={{textAlign:'right'}}>{s.revenue?s.revenue.toLocaleString()+'원':'-'}</td>
            {role==='master' && <>
              <td style={{textAlign:'right',whiteSpace:'nowrap'}}>
                <input value={rates[t]??''} placeholder="0" onChange={e=>setRate(t,e.target.value)}
                  style={{width:44,background:'var(--forest)',border:'1px solid var(--line)',borderRadius:8,padding:'4px 6px',color:'var(--cream)',fontSize:13,textAlign:'right'}}/> %
              </td>
              <td style={{textAlign:'right',fontWeight:700,color:'var(--brass)'}}>{s.revenue&&rates[t]?Math.round(s.revenue*rates[t]/100).toLocaleString()+'원':'-'}</td>
            </>}
          </tr>))}</tbody></table>}
      <p className="muted" style={{fontSize:12,margin:'8px 0 0'}}>매출 기여 = 이달 결제 중 해당 강사 담당 회원권으로 들어온 금액.{role==='master'?' 정산액 = 매출 기여 × 정산율(%). 정산율은 자동 저장되며 마스터에게만 보입니다.':''}</p>
    </div>
    <div className="mp-cardbox">
      <h3><span>거래 내역 {monthPays.length?`(${monthPays.length})`:''}</span>{monthPays.length>0 && <button className="btn ghost sm" onClick={exportCSV}>⤓ 엑셀 내보내기</button>}</h3>
      {pays===null? <div className="muted">불러오는 중...</div> :
        monthPays.length===0? <div className="muted">거래 내역이 없습니다</div> :
        <table className="ptable"><thead><tr><th>거래일</th><th>회원</th><th>구분</th><th>등록구분</th><th style={{textAlign:'right'}}>금액</th></tr></thead>
          <tbody>{monthPays.map(p=>(<tr key={p.id}>
            <td>{fmtDate(p.paid_at)}</td><td>{nameById[p.member_id]||'-'}</td>
            <td style={p.amount<0?{color:'#d98b7a'}:undefined}>{p.method||'-'}</td>
            <td className="muted" style={{fontSize:13}}>{regLabel(p)}</td>
            <td style={{textAlign:'right',color:p.amount<0?'#d98b7a':undefined}}>{(p.amount||0).toLocaleString()}원</td>
          </tr>))}</tbody></table>}
    </div>
    <p className="muted" style={{fontSize:12,marginTop:14}}>※ 앱에서 회원권/레슨 등록 시 기록된 결제만 집계됩니다. 브로제이 과거 매출은 반영되지 않습니다.</p>
    </>}
  </div>);
}

// ---------- 수업 통계 ----------
// "선생님별로 몇 개를, 언제, 어떻게 했는지"를 한 화면에서 본다.
//   몇 개 → 요약 카드 + 강사별 표
//   언제  → 일별 막대 + 요일×시간대 히트맵
//   어떻게 → 완료/노쇼/휴강/예약 구분
// ★매출 탭의 '강사별 실적'과 다른 점: 이쪽은 돈이 아니라 **수업 자체**가 주제라
//   매출 권한 없는 프리랜서도 볼 수 있고(캘린더 권한), 시간대·요일 분포를 다룬다.
const DOW_LABEL=['일','월','화','수','목','금','토'];
function LessonStatsView({sb}){
  const [ref,setRef]=useState(()=>{const d=new Date();return {y:d.getFullYear(),m:d.getMonth()};});
  const [rows,setRows]=useState(null);
  const [members,setMembers]=useState({});
  const [colors,setColors]=useState({});
  const [pick,setPick]=useState('all');     // 강사 필터
  const [err,setErr]=useState('');
  useEffect(()=>{ (async()=>{
    setRows(null); setErr('');
    const s=new Date(ref.y,ref.m,1), e=new Date(ref.y,ref.m+1,1);
    const {data,error}=await fetchAll(()=>sb.from('lessons')
      .select('id,start_at,end_at,lesson_name,trainer,status,member_id')
      .gte('start_at',s.toISOString()).lt('start_at',e.toISOString()).order('start_at'));
    if(error){ setErr(error.message); setRows([]); return; }
    setRows(data||[]);
  })(); },[ref]);
  useEffect(()=>{
    fetchAll(()=>sb.from('members').select('id,name').order('id')).then(({data})=>{
      const o={}; (data||[]).forEach(m=>o[m.id]=m.name); setMembers(o); });
    sb.from('trainer_colors').select('name,color').then(({data})=>{
      const o={}; (data||[]).forEach(r=>o[r.name]=r.color); setColors(o); });
  },[]);

  const all=rows||[];
  const trainers=useMemo(()=>[...new Set(all.map(l=>l.trainer||'미지정'))].sort((a,b)=>a.localeCompare(b,'ko')),[all]);
  const color=t=>colors[t]||TRAINER_PALETTE[Math.max(0,trainers.indexOf(t))%TRAINER_PALETTE.length];
  const view=pick==='all'? all : all.filter(l=>(l.trainer||'미지정')===pick);

  const cnt=s=>view.filter(l=>l.status===s).length;
  const done=cnt('완료'), booked=cnt('예약'), noshow=cnt('노쇼'), rest=cnt('휴강');
  const total=view.length;
  // 실제로 진행된 수업 = 완료 + 노쇼(차감 유지되므로 진행분으로 본다)
  const held=done+noshow;

  const daysInMonth=new Date(ref.y,ref.m+1,0).getDate();
  const byDay=useMemo(()=>{ const a=Array.from({length:daysInMonth},()=>0);
    view.forEach(l=>{ if(l.status==='휴강') return; const d=new Date(l.start_at).getDate();
      if(d>=1&&d<=daysInMonth) a[d-1]++; }); return a; },[view,daysInMonth]);
  const maxDay=Math.max(1,...byDay);

  // 요일 × 시간대 — "언제 수업이 몰리는가"
  const heat=useMemo(()=>{ const h={}; let mx=0;
    view.forEach(l=>{ if(l.status==='휴강') return; const d=new Date(l.start_at);
      const key=d.getDay()+'_'+d.getHours(); h[key]=(h[key]||0)+1; if(h[key]>mx) mx=h[key]; });
    return {h,mx}; },[view]);
  const hours=useMemo(()=>{ const s=new Set();
    view.forEach(l=>{ if(l.status!=='휴강') s.add(new Date(l.start_at).getHours()); });
    return [...s].sort((a,b)=>a-b); },[view]);

  // 강사별 집계 (필터와 무관하게 항상 전체 기준 — 비교가 목적이므로)
  const perTrainer=useMemo(()=>{
    const o={};
    all.forEach(l=>{ const t=l.trainer||'미지정';
      const v=o[t]=o[t]||{done:0,booked:0,noshow:0,rest:0,mem:new Set(),names:{}};
      if(l.status==='완료')v.done++; else if(l.status==='예약')v.booked++;
      else if(l.status==='노쇼')v.noshow++; else if(l.status==='휴강')v.rest++;
      if(l.member_id)v.mem.add(l.member_id);
      const n=l.lesson_name||'-'; v.names[n]=(v.names[n]||0)+1; });
    return Object.entries(o).map(([t,v])=>({t,...v,held:v.done+v.noshow,tot:v.done+v.booked+v.noshow+v.rest}))
      .sort((a,b)=>b.held-a.held||b.tot-a.tot);
  },[all]);
  const heldAll=perTrainer.reduce((s,x)=>s+x.held,0);

  function move(d){ setRef(r=>{ let m=r.m+d,y=r.y; if(m<0){m=11;y--;} if(m>11){m=0;y++;} return {y,m}; }); }
  const isThisMonth=(()=>{const d=new Date();return d.getFullYear()===ref.y&&d.getMonth()===ref.m;})();
  function exportCSV(){
    const out=[['강사','진행(완료+노쇼)','완료','노쇼','휴강','예정','수업회원수','비중%']];
    perTrainer.forEach(x=>out.push([x.t,x.held,x.done,x.noshow,x.rest,x.booked,x.mem.size,
      heldAll?Math.round(x.held/heldAll*100):0]));
    downloadCSV(`수업통계_${ref.y}-${pad(ref.m+1)}.csv`,out);
  }

  // 도넛 (진행 기준)
  const donut=(()=>{ const R=54,C=2*Math.PI*R; let acc=0;
    return perTrainer.filter(x=>x.held>0).map(x=>{ const frac=heldAll?x.held/heldAll:0;
      const seg={t:x.t,dash:`${C*frac} ${C*(1-frac)}`,off:-C*acc,color:color(x.t),pct:Math.round(frac*100)};
      acc+=frac; return seg; }); })();

  return (<div>
    <div className="sales-nav">
      <button onClick={()=>move(-1)}>← 이전달</button>
      <div className="per">{ref.y}년 {ref.m+1}월{isThisMonth?' (이번 달)':''}</div>
      <button onClick={()=>move(1)}>다음달 →</button>
    </div>
    {err && <div className="err">불러오지 못했습니다: {err}</div>}
    {rows===null? <div className="empty">불러오는 중...</div> : <>
    <div className="stats">
      <div className="stat"><div className="n">{held}</div><div className="l">진행한 수업 (완료+노쇼)</div></div>
      <div className="stat"><div className="n" style={{color:'#7dc4a0'}}>{done}</div><div className="l">완료</div></div>
      <div className="stat"><div className="n" style={{color:noshow?'#d98b7a':'var(--muted)'}}>{noshow}</div><div className="l">노쇼</div></div>
      <div className="stat"><div className="n" style={{color:'var(--brass)'}}>{booked}</div><div className="l">예정</div></div>
      <div className="stat"><div className="n muted">{rest}</div><div className="l">휴강</div></div>
    </div>

    {trainers.length>0 && <div className="trainer-legend">
      <button className={'tl-chip'+(pick==='all'?' on':'')} onClick={()=>setPick('all')}>전체 강사</button>
      {trainers.map(t=>(
        <button key={t} className={'tl-chip'+(pick===t?' on':'')} onClick={()=>setPick(p=>p===t?'all':t)}
          style={pick===t?{background:color(t),color:trainerFg(color(t)),borderColor:'transparent'}:undefined}>
          <i style={{background:color(t)}}/>{t}
        </button>))}
      {pick!=='all' && <span className="muted" style={{fontSize:12,alignSelf:'center'}}>· '{pick}' 강사만 보는 중 (아래 표는 항상 전체)</span>}
      <button className="btn ghost sm" style={{marginLeft:'auto'}} onClick={exportCSV}>⤓ 엑셀</button>
    </div>}

    {total===0? <div className="empty" style={{marginTop:16}}>{ref.m+1}월에 등록된 수업이 없습니다.</div> : <>
    <div className="mp-cardbox" style={{marginBottom:16}}>
      <h3><span>일별 수업 · {ref.m+1}월</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>휴강 제외 · 최다 {maxDay}건</span></h3>
      <div className="saleschart">
        {byDay.map((v,i)=><div key={i} className="bar" style={{height:Math.max(2,v/maxDay*100)+'%',opacity:v?1:.18}} title={`${ref.m+1}/${i+1} · ${v}건`}/>)}
      </div>
      <div className="saleschart-x">{byDay.map((v,i)=><span key={i}>{(i+1)%5===0||i===0?i+1:''}</span>)}</div>
    </div>

    <div className="dash-grid" style={{marginBottom:16}}>
      <div className="mp-cardbox">
        <h3><span>강사별 비중</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>진행 {heldAll}건</span></h3>
        {heldAll===0? <div className="muted">진행된 수업이 없습니다</div> :
        <div style={{display:'flex',alignItems:'center',gap:18,flexWrap:'wrap'}}>
          <svg viewBox="0 0 140 140" style={{width:140,height:140,flex:'none',transform:'rotate(-90deg)'}}>
            {donut.map(s=>(<circle key={s.t} cx="70" cy="70" r="54" fill="none" stroke={s.color} strokeWidth="22"
              strokeDasharray={s.dash} strokeDashoffset={s.off}/>))}
          </svg>
          <div style={{flex:1,minWidth:150}}>
            {donut.map(s=>(<div key={s.t} className="kv" style={{padding:'3px 0'}}>
              <span style={{display:'flex',alignItems:'center',gap:7}}>
                <i style={{width:10,height:10,borderRadius:3,background:s.color,display:'inline-block'}}/>{s.t}</span>
              <b>{s.pct}%</b></div>))}
          </div>
        </div>}
      </div>

      <div className="mp-cardbox">
        <h3><span>요일 · 시간대 분포</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{pick==='all'?'전체':pick}</span></h3>
        {hours.length===0? <div className="muted">표시할 수업이 없습니다</div> :
        <div style={{overflowX:'auto'}}>
          <table className="heat"><tbody>
            <tr><th></th>{DOW_LABEL.map((d,i)=><th key={i}>{d}</th>)}</tr>
            {hours.map(h=>(<tr key={h}>
              <th>{pad(h)}시</th>
              {DOW_LABEL.map((_,dw)=>{ const n=heat.h[dw+'_'+h]||0;
                return <td key={dw} title={`${DOW_LABEL[dw]} ${pad(h)}시 · ${n}건`}
                  style={{background:n?`rgba(176,141,87,${0.14+0.72*(n/heat.mx)})`:'transparent',
                          color:n/heat.mx>0.55?'#1b1205':'var(--muted)'}}>{n||''}</td>; })}
            </tr>))}
          </tbody></table>
          <div className="muted" style={{fontSize:11,marginTop:6}}>진한 칸일수록 수업이 몰린 시간대입니다 (휴강 제외)</div>
        </div>}
      </div>
    </div>

    <div className="mp-cardbox">
      <h3><span>강사별 상세</span><span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{ref.m+1}월 · 전체 기준</span></h3>
      <table className="ptable">
        <thead><tr><th>강사</th>
          <th style={{textAlign:'right'}}>진행</th><th style={{textAlign:'right'}}>완료</th>
          <th style={{textAlign:'right'}}>노쇼</th><th style={{textAlign:'right'}}>휴강</th>
          <th style={{textAlign:'right'}}>예정</th><th style={{textAlign:'right'}}>수업회원</th>
          <th style={{textAlign:'right'}}>비중</th></tr></thead>
        <tbody>{perTrainer.map(x=>(<tr key={x.t}>
          <td style={{fontWeight:700}}><span style={{display:'inline-block',width:9,height:9,borderRadius:3,background:color(x.t),marginRight:7}}/>{x.t}</td>
          <td style={{textAlign:'right',fontWeight:700}}>{x.held}</td>
          <td style={{textAlign:'right'}}>{x.done}</td>
          <td style={{textAlign:'right',color:x.noshow?'#d98b7a':undefined}}>{x.noshow}</td>
          <td style={{textAlign:'right'}} className="muted">{x.rest}</td>
          <td style={{textAlign:'right',color:'var(--brass)'}}>{x.booked}</td>
          <td style={{textAlign:'right'}}>{x.mem.size}명</td>
          <td style={{textAlign:'right'}}>{heldAll?Math.round(x.held/heldAll*100):0}%</td>
        </tr>))}</tbody>
      </table>
      <p className="muted" style={{fontSize:12,margin:'10px 0 0'}}>
        '진행' = 완료 + 노쇼 (노쇼도 회차가 차감되므로 수행분으로 봅니다) · '예정'은 아직 지나지 않은 예약입니다.
      </p>
    </div>
    </>}
    </>}
  </div>);
}

// ---------- 상품 관리 ----------
const PROD_CATS=['PT','헬스','1:1','컨디셔닝','락커','기타'];
function ProductsView({sb}){
  const [rows,setRows]=useState(null);
  const [edit,setEdit]=useState(null),[adding,setAdding]=useState(false);
  const [bulk,setBulk]=useState(false),[drafts,setDrafts]=useState([]),[busyBulk,setBusyBulk]=useState(false),[bulkMsg,setBulkMsg]=useState('');
  async function load(){ const {data}=await sb.from('products').select('*').order('sort'); setRows(data||[]); }
  useEffect(()=>{ load(); },[]);
  function startBulk(){
    setDrafts((rows||[]).map(p=>({id:p.id,name:p.name||'',category:p.category||'PT',count:p.count!=null?String(p.count):'',days:p.days!=null?String(p.days):'',months:p.months!=null?String(p.months):'',unlimited:p.unlimited===true,price_cash:p.price_cash?p.price_cash.toLocaleString():'',price_card:p.price_card?p.price_card.toLocaleString():'',active:p.active!==false})));
    setBulkMsg(''); setBulk(true);
  }
  function setD(i,k,v){ setDrafts(d=>d.map((r,j)=>j===i?{...r,[k]:v}:r)); }
  function addRow(){ setDrafts(d=>[...d,{name:'',category:'헬스',count:'',days:'',months:'',unlimited:false,price_cash:'',price_card:'',active:true,_new:true}]); }
  async function saveBulk(){
    setBusyBulk(true); setBulkMsg('');
    const num=v=>{ const n=parseInt(String(v||'').replace(/\D/g,'')); return isNaN(n)||n<=0?null:n; };
    let saved=0; const errs=[];
    for(let i=0;i<drafts.length;i++){ const d=drafts[i];
      if(!d.name.trim()){ if(!d._new) errs.push(`${i+1}행: 상품명이 비었습니다`); continue; }
      const cash=num(d.price_cash), card=num(d.price_card);
      const payload={name:d.name.trim(),category:d.category,count:num(d.count),days:d.unlimited?null:num(d.days),months:d.unlimited?null:num(d.months),unlimited:!!d.unlimited,price_cash:cash,price_card:card,price:card||cash,active:!!d.active};
      const q= d.id? await sb.from('products').update(payload).eq('id',d.id) : await sb.from('products').insert({...payload,sort:Date.now()%100000+i});
      if(q.error) errs.push(`${d.name}: ${q.error.message}`); else saved++;
    }
    setBusyBulk(false);
    if(errs.length){ setBulkMsg('⚠ '+errs.join(' · ')); return; }
    logAct(sb,'상품 일괄수정',`${saved}개 저장`);
    setBulk(false); load();
  }
  const inp={width:'100%',background:'var(--forest)',border:'1px solid var(--line)',borderRadius:7,padding:'7px 9px',color:'var(--cream)',fontSize:13};
  return (<div>
    <div className="bar" style={{marginTop:18}}>
      <div className="muted" style={{fontSize:14}}>{bulk?'표에서 바로 수정하세요. 비어있는 칸(가격·기간)을 채우고 저장을 누르면 한 번에 반영됩니다.':'회원 등록 시 고를 수 있는 상품(회원권) 목록입니다. 클릭하면 수정됩니다.'}</div>
      <div style={{flex:1}}/>
      {!bulk && <button className="btn ghost sm" onClick={startBulk}>⚡ 일괄 입력</button>}
      {!bulk && <button className="btn" onClick={()=>setAdding(true)}>＋ 상품 추가</button>}
      {bulk && <button className="btn ghost sm" onClick={()=>setBulk(false)}>취소</button>}
      {bulk && <button className="btn ghost sm" onClick={addRow}>＋ 행 추가</button>}
      {bulk && <button className="btn" disabled={busyBulk} onClick={saveBulk}>{busyBulk?'저장 중...':'전체 저장'}</button>}
    </div>
    {bulkMsg && <div className="err" style={{marginBottom:10}}>{bulkMsg}</div>}
    {rows===null? <div className="empty">불러오는 중...</div> :
     bulk? (
     <div className="list" style={{marginBottom:40,overflowX:'auto'}}>
       <div className="row prodedit head"><div>상품명</div><div>종류</div><div>횟수</div><div>기간(일)</div><div>기간(개월)</div><div>무제한</div><div>현금가</div><div>카드가</div><div>판매</div></div>
       {drafts.map((d,i)=>(
         <div className="row prodedit" key={d.id||'n'+i} style={{cursor:'default'}}>
           <div><input style={inp} value={d.name} placeholder="상품명" onChange={e=>setD(i,'name',e.target.value)}/></div>
           <div><select style={inp} value={d.category} onChange={e=>setD(i,'category',e.target.value)}>{PROD_CATS.map(c=><option key={c}>{c}</option>)}</select></div>
           <div><input style={inp} type="number" value={d.count} placeholder="-" onChange={e=>setD(i,'count',e.target.value)}/></div>
           <div><input style={{...inp,opacity:d.unlimited?.35:1}} type="number" disabled={d.unlimited} value={d.unlimited?'':d.days} placeholder={d.unlimited?'무제한':'-'} onChange={e=>setD(i,'days',e.target.value)}/></div>
           <div><input style={{...inp,opacity:d.unlimited?.35:1}} type="number" disabled={d.unlimited} value={d.unlimited?'':d.months} placeholder={d.unlimited?'무제한':'-'} onChange={e=>setD(i,'months',e.target.value)}/></div>
           <div style={{textAlign:'center'}}><input type="checkbox" checked={d.unlimited} onChange={e=>setD(i,'unlimited',e.target.checked)} title="기간 무제한"/></div>
           <div><input style={inp} value={d.price_cash} placeholder="현금가" onChange={e=>setD(i,'price_cash',fmtNum(e.target.value))}/></div>
           <div><input style={inp} value={d.price_card} placeholder="카드가" onChange={e=>setD(i,'price_card',fmtNum(e.target.value))}/></div>
           <div style={{textAlign:'center'}}><input type="checkbox" checked={d.active} onChange={e=>setD(i,'active',e.target.checked)}/></div>
         </div>))}
     </div>) :
     rows.length===0? <div className="empty">등록된 상품이 없습니다. ＋상품 추가로 시작하세요.</div> :
     <div className="list" style={{marginBottom:40}}>
       <div className="row prod head"><div>상품명</div><div>종류</div><div>횟수</div><div>기간</div><div>현금가 / 카드가</div><div>상태</div></div>
       {rows.map(p=>(
         <div className="row prod" key={p.id} onClick={()=>setEdit(p)}>
           <div className="name">{p.name}</div>
           <div className="muted">{p.category||'-'}</div>
           <div className="muted">{p.count?p.count+'회':'-'}</div>
           <div className="muted">{p.unlimited?'무제한':(p.days?p.days+'일':(p.months?p.months+'개월':'-'))}</div>
           <div>{(p.price_cash||p.price_card||p.price)? `${(p.price_cash||p.price||0).toLocaleString()} / ${(p.price_card||p.price||0).toLocaleString()}원` : '-'}</div>
           <div><span className={'badge '+(p.active?'b-활성':'b-만료')}>{p.active?'판매중':'중지'}</span></div>
         </div>))}
     </div>}
    {adding && <ProductModal sb={sb} onClose={()=>setAdding(false)} onSaved={()=>{setAdding(false);load();}}/>}
    {edit && <ProductModal sb={sb} product={edit} onClose={()=>setEdit(null)} onSaved={()=>{setEdit(null);load();}}/>}
  </div>);
}

function ProductModal({sb,product,onClose,onSaved}){
  useEsc(onClose);
  const p=product||{};
  const [name,setName]=useState(p.name||'');
  const [category,setCategory]=useState(p.category||'PT');
  const [count,setCount]=useState(p.count!=null?String(p.count):'');
  const [priceCash,setPriceCash]=useState(p.price_cash?p.price_cash.toLocaleString():(p.price?p.price.toLocaleString():''));
  const [priceCard,setPriceCard]=useState(p.price_card?p.price_card.toLocaleString():(p.price?p.price.toLocaleString():''));
  const [months,setMonths]=useState(p.months!=null?String(p.months):'');
  const [days,setDays]=useState(p.days!=null?String(p.days):'');
  const [unlimited,setUnlimited]=useState(p.unlimited===true);
  const [active,setActive]=useState(p.active!==false);
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function save(){
    if(!name.trim()) return setErr('상품명을 입력하세요');
    setBusy(true);
    const _cash=parseInt((priceCash||'').replace(/\D/g,''))||null, _card=parseInt((priceCard||'').replace(/\D/g,''))||null;
    const payload={name:name.trim(),category,count:parseInt(count)||null,price_cash:_cash,price_card:_card,price:_card||_cash,months:unlimited?null:(parseInt(months)||null),days:unlimited?null:(parseInt(days)||null),unlimited,active};
    const {error}= product? await sb.from('products').update(payload).eq('id',product.id) : await sb.from('products').insert({...payload,sort:Date.now()%100000});
    setBusy(false); if(error){ setErr('저장 실패: '+error.message); return; }
    logAct(sb,product?'상품 수정':'상품 추가',name.trim());
    onSaved();
  }
  async function del(){
    if(!confirm('이 상품을 삭제할까요? (이미 등록된 회원권에는 영향 없음)')) return;
    const {error}=await sb.from('products').delete().eq('id',product.id);
    if(error){ setErr('삭제 실패: '+error.message); return; }
    logAct(sb,'상품 삭제',product.name);
    onSaved();
  }
  return (<div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="mhead"><h3>{product?'상품 수정':'상품 추가'}</h3><button className="xbtn" onClick={onClose}>✕</button></div>
    <div className="field"><label>상품명</label><input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="예: PT 10회권 / 3개월 헬스권"/></div>
    <div className="row2">
      <div className="field" style={{flex:1}}><label>종류</label><select value={category} onChange={e=>setCategory(e.target.value)}>{PROD_CATS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="field" style={{flex:1}}><label>횟수 <span className="muted" style={{fontWeight:400}}>· 기간제면 비움</span></label><input type="number" value={count} onChange={e=>setCount(e.target.value)} placeholder="10"/></div>
    </div>
    <div className="row2">
      <div className="field" style={{flex:1}}><label>현금가(원)</label><input value={priceCash} onChange={e=>setPriceCash(fmtNum(e.target.value))} placeholder="1,200,000"/></div>
      <div className="field" style={{flex:1}}><label>카드가(원) <span className="muted" style={{fontWeight:400}}>· 같으면 동일 입력</span></label><input value={priceCard} onChange={e=>setPriceCard(fmtNum(e.target.value))} placeholder="1,320,000"/></div>
    </div>
    <div className="row2">
      <div className="field" style={{flex:1}}><label>기간(일) <span className="muted" style={{fontWeight:400}}>· 예: 35</span></label><input type="number" value={unlimited?'':days} disabled={unlimited} placeholder={unlimited?'무제한':'35'} onChange={e=>setDays(e.target.value)}/></div>
      <div className="field" style={{flex:1}}><label>기간(개월) <span className="muted" style={{fontWeight:400}}>· 일 입력 시 무시</span></label><input type="number" value={unlimited?'':months} disabled={unlimited} placeholder={unlimited?'무제한':'3'} onChange={e=>setMonths(e.target.value)}/></div>
    </div>
    <label style={{display:'flex',alignItems:'center',gap:6,fontSize:14,margin:'2px 0 10px',cursor:'pointer'}}><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)}/> 기간 무제한 (등록 시 만료일 없음)</label>
    <label style={{display:'flex',alignItems:'center',gap:6,fontSize:14,margin:'2px 0 12px',cursor:'pointer'}}><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> 판매중 (등록 화면에 표시)</label>
    {err && <div className="err">{err}</div>}
    <div style={{display:'flex',gap:8}}>
      <button className="btn" style={{flex:1}} disabled={busy} onClick={save}>{busy?'저장 중...':'저장'}</button>
      {product && <button className="btn ghost" style={{color:'#d98b7a',borderColor:'#5a2e28'}} onClick={del}>삭제</button>}
    </div>
  </div></div>);
}

// ---------- 로그 기록 ----------
// ---------- 자동 백업 · 복원 패널 ----------
// 홈 배너용: 심각한 모순(bad)이 있을 때만 알린다.
// 평소엔 홈을 깨끗하게 두고, 실제 모순이 생긴 날에만 눈에 걸리게 하는 것이 목적.
// 마스터만 호출한다(crm_health가 마스터 전용이라 프리랜서는 에러가 됨).
function useHealthAlert(sb, role){
  const [bad,setBad]=useState(null);
  useEffect(()=>{
    if(!sb || role!=='master'){ setBad(null); return; }
    let alive=true;
    (async()=>{
      try{
        const {data,error}=await sb.rpc('crm_health');
        if(!alive || error || !data || !data.checks) return;
        setBad(data.checks.filter(c=>c.level==='bad' && c.n>0));
      }catch(e){}
    })();
    return ()=>{ alive=false; };
  },[sb,role]);
  return bad;
}

// ---------- 데이터 자가진단 ----------
// 왜 있나: 2026-07-25~26 회차 이중차감은 백업과 대조해서야 드러났다.
// "잔여 > 총회차" 같은 모순을 앱이 상시 보여주면 사용자가 직접 발견할 수 있다.
// 서버 RPC crm_health()가 검사 14종을 한 번에 계산한다(마스터 전용, db/health_check.sql).
function HealthPanel({sb,onOpenMember}){
  const [data,setData]=useState(null);   // null=미로드 / 'na'=함수 없음 / {}=결과
  const [busy,setBusy]=useState(false);
  const [open,setOpen]=useState(false);
  const [showOk,setShowOk]=useState(false);
  // 펼쳐둔 상세 목록의 최신 상태를 load() 안에서 읽기 위한 ref.
  // (load는 콜백으로도 불려서 state를 직접 읽으면 옛 값이 잡힌다)
  const detailRef=useRef({});
  const [lastAt,setLastAt]=useState('');
  // "다시 검사" = 건수 + **펼쳐져 있는 상세까지** 서버에서 새로 가져온다.
  // 이걸 안 하면 회원 데이터를 고쳐도 캐시된 상세가 그대로 떠서
  // 새로고침(F5) 해야만 반영되는 것처럼 보인다.
  async function load(){
    setBusy(true);
    const {data:d,error}=await sb.rpc('crm_health');
    if(error){
      setBusy(false);
      setData(/does not exist|schema cache/i.test(error.message)?'na':{err:error.message});
      return;
    }
    setData(d||{});
    const openKeys=Object.keys(detailRef.current).filter(k=>detailRef.current[k] && detailRef.current[k].open);
    if(openKeys.length){
      const res=await Promise.all(openKeys.map(k=>sb.rpc('crm_health_detail',{p_key:k,p_limit:200})));
      setDetail(()=>{
        const next={};   // 닫혀 있던 캐시는 버린다 — 다음에 펼칠 때 새로 받게
        openKeys.forEach((k,i)=>{
          const {data:dd,error:ee}=res[i];
          next[k]= ee ? {open:true,err:ee.message}
                      : {open:true,rows:(dd&&dd.rows)||[],limit:(dd&&dd.limit)||200};
        });
        return next;
      });
    } else setDetail({});
    setDis(null);        // 제외 목록도 다시 받도록 무효화
    setLastAt(new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
    setBusy(false);
  }
  useEffect(()=>{ if(open && data===null) load(); },[open]);

  const checks=(data&&data.checks)||[];
  const bad =checks.filter(c=>c.level==='bad'  && c.n>0);
  const warn=checks.filter(c=>c.level==='warn' && c.n>0);
  const info=checks.filter(c=>c.level==='info');
  const okCount=checks.filter(c=>c.level!=='info' && c.n===0).length;
  const dismissedN=(data&&data.dismissed)||0;
  // 헤더 배지: 심각한 모순이 있으면 빨강, 확인거리만 있으면 주황, 아니면 초록
  const sev = bad.length? 'bad' : warn.length? 'warn' : checks.length? 'ok' : '';
  const badge = sev==='bad' ? `⚠️ 이상 ${bad.length}건`
              : sev==='warn'? `확인 ${warn.length}건`
              : sev==='ok'  ? '정상' : '';
  // 상세 내역: 펼칠 때만 서버에서 가져온다(info 검사는 수백 건이라 미리 받으면 낭비).
  const [detail,setDetail]=useState({});   // {key:{rows,limit,busy,err}}
  useEffect(()=>{ detailRef.current=detail; },[detail]);
  async function toggleDetail(key){
    const cur=detail[key];
    if(cur && cur.open){ setDetail(d=>({...d,[key]:{...cur,open:false}})); return; }
    if(cur && cur.rows){ setDetail(d=>({...d,[key]:{...cur,open:true}})); return; }
    setDetail(d=>({...d,[key]:{open:true,busy:true}}));
    const {data,error}=await sb.rpc('crm_health_detail',{p_key:key,p_limit:200});
    setDetail(d=>({...d,[key]: error
      ? {open:true,err:/does not exist|schema cache/i.test(error.message)?'상세보기 기능이 아직 DB에 설치되지 않았습니다. (db/health_detail.sql 실행 필요)':error.message}
      : {open:true,rows:(data&&data.rows)||[],limit:(data&&data.limit)||200}}));
  }
  // "문제없음" 처리 — 사유를 물어보고(선택) 제외 등록. 낙관적 갱신 없이 서버 재조회로 맞춘다.
  const [busyKey,setBusyKey]=useState('');
  async function dismissOne(key,r){
    const note=prompt(`이 항목을 진단에서 제외합니다.\n\n${r.who} — ${r.what}\n\n사유를 남겨두면 나중에 검토할 때 도움이 됩니다. (선택, 비워도 됩니다)`,'');
    if(note===null) return;   // 취소
    setBusyKey(key+':'+r.id);
    const {error}=await sb.rpc('crm_health_dismiss',
      {p_key:key,p_target_id:r.id,p_label:`${r.who} — ${r.what}`,p_note:note});
    setBusyKey('');
    if(error){ alert('제외 처리 실패: '+error.message); return; }
    setDis(null);      // 제외 목록 캐시 무효화
    await load();      // 건수 + 펼쳐진 상세를 서버 기준으로 다시 맞춘다
  }
  // 제외 목록
  const [dis,setDis]=useState(null);
  const [disOpen,setDisOpen]=useState(false);
  async function loadDis(){
    const {data,error}=await sb.rpc('crm_health_dismissed');
    setDis(error?{err:error.message}:(data||[]));
  }
  useEffect(()=>{ if(disOpen && dis===null) loadDis(); },[disOpen,dis]);
  async function restoreOne(x){
    if(!confirm(`이 항목을 다시 진단 대상으로 되돌립니다.\n\n${x.label||''}\n\n계속할까요?`)) return;
    const {error}=await sb.rpc('crm_health_restore',{p_id:x.id});
    if(error){ alert('되돌리기 실패: '+error.message); return; }
    setDis(null); load();   // load가 펼쳐진 상세까지 다시 받아온다
  }
  const Row=({c})=>{
    const d=detail[c.key]||{};
    return (<div className={'hc-row hc-'+c.level}>
      <span className="hc-dot"/>
      <div className="hc-body">
        <div className="hc-label">{c.label}</div>
        {c.hint && <div className="hc-hint">{c.hint}</div>}
        {d.open && <div className="hc-detail">
          {d.busy ? <div className="muted" style={{fontSize:12.5,padding:'6px 0'}}>불러오는 중...</div>
           : d.err ? <div className="err" style={{margin:'6px 0 0'}}>{d.err}</div>
           : (d.rows||[]).length===0 ? <div className="muted" style={{fontSize:12.5,padding:'6px 0'}}>해당하는 항목이 없습니다.</div>
           : <>
              <table className="hc-table"><tbody>
                {d.rows.map((r,i)=>(<tr key={r.id+'_'+i}>
                  <td className="hc-who">
                    {r.member_id
                      ? <button className="link" style={{margin:0,fontSize:12.5,textAlign:'left'}}
                          onClick={()=>onOpenMember && onOpenMember(r.member_id)}>{r.who}</button>
                      : <span>{r.who}</span>}
                  </td>
                  <td className="hc-what">
                    <div>{r.what}</div>
                    {r.why && <div className="hc-why">{r.why}</div>}
                  </td>
                  <td className="hc-when">{r.when||''}</td>
                  <td className="hc-act">
                    <button className="hc-okbtn" title="이 항목을 진단에서 제외합니다"
                      disabled={busyKey===c.key+':'+r.id}
                      onClick={()=>dismissOne(c.key,r)}>
                      {busyKey===c.key+':'+r.id?'처리 중...':'☑ 문제없음'}
                    </button>
                  </td>
                </tr>))}
              </tbody></table>
              {c.n > d.rows.length &&
                <div className="muted" style={{fontSize:12,marginTop:6}}>
                  최근 {d.rows.length.toLocaleString()}건만 표시 · 외 {(c.n-d.rows.length).toLocaleString()}건 더 있습니다
                </div>}
             </>}
        </div>}
      </div>
      <div style={{flex:'none',textAlign:'right'}}>
        <div className="hc-n">{c.n.toLocaleString()}건</div>
        {c.n>0 && <button className="link" style={{margin:'4px 0 0',fontSize:12}}
          onClick={()=>toggleDetail(c.key)}>{d.open?'접기 ▲':'상세보기 ▼'}</button>}
      </div>
    </div>);
  };
  return (<div className="mp-cardbox" style={{marginBottom:16}}>
    <h3 style={{cursor:'pointer'}} onClick={()=>setOpen(o=>!o)}>
      <span>🩺 데이터 자가진단</span>
      <span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:700,
        color: sev==='bad'?'#d98b7a':sev==='warn'?'#e0a23c':sev==='ok'?'#7dc4a0':undefined}}>
        {open?'▲':'▼'} {badge}
      </span>
    </h3>
    {open && <>
      {data==='na' ? <div className="muted" style={{fontSize:12.5}}>진단 기능이 아직 DB에 설치되지 않았습니다. (db/health_check.sql 실행 필요)</div>
       : data && data.err ? <div className="err">{data.err}</div>
       : data===null ? <div className="muted">불러오는 중...</div>
       : <>
        <p className="muted" style={{fontSize:12.5,margin:'0 0 10px'}}>
          숫자·금액이 서로 맞지 않는 상태를 찾아냅니다. <b>이상</b>은 있으면 안 되는 모순이라 바로 확인이 필요하고, <b>확인</b>은 정리하면 좋은 항목입니다.
        </p>
        {bad.length===0 && warn.length===0 &&
          <div className="hc-allok">✅ 데이터 모순이 발견되지 않았습니다 ({okCount}개 항목 정상)</div>}
        {bad.map(c=><Row key={c.key} c={c}/>)}
        {warn.map(c=><Row key={c.key} c={c}/>)}
        {showOk && <>
          {checks.filter(c=>c.level!=='info' && c.n===0).map(c=>(
            <div className="hc-row hc-ok" key={c.key}>
              <span className="hc-dot"/>
              <div className="hc-body"><div className="hc-label" style={{color:'var(--muted)'}}>{c.label}</div></div>
              <span className="hc-n" style={{color:'#7dc4a0'}}>정상</span>
            </div>))}
          <div style={{borderTop:'1px solid var(--line)',marginTop:6,paddingTop:8}}/>
          {info.map(c=><Row key={c.key} c={c}/>)}
        </>}
        <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
          <button className="btn ghost sm" disabled={busy} onClick={load}>{busy?'검사 중...':'🔄 다시 검사'}</button>
          {lastAt && <span className="muted" style={{fontSize:11.5,alignSelf:'center'}}>{lastAt} 기준</span>}
          <button className="btn ghost sm" onClick={()=>setShowOk(v=>!v)}>{showOk?'정상 항목 접기':`정상·참고 항목 보기 (${okCount+info.length})`}</button>
          {dismissedN>0 && <button className="btn ghost sm" onClick={()=>setDisOpen(v=>!v)}>
            {disOpen?'제외 목록 접기':`🗂 제외한 항목 (${dismissedN})`}</button>}
        </div>
        {/* 제외 목록 — 실수로 제외한 게 없는지 검토하는 자리.
            '지금은 해당 없음'은 데이터가 바뀌어 더는 문제가 아니라는 뜻이라 되돌려도 안전하다. */}
        {disOpen && <div className="hc-dismissed">
          <div className="hc-hint" style={{marginBottom:8}}>
            제외한 항목은 진단 건수에서 빠집니다. 잘못 제외한 게 없는지 여기서 확인하고 되돌릴 수 있습니다.
          </div>
          {dis===null ? <div className="muted" style={{fontSize:12.5}}>불러오는 중...</div>
           : dis.err ? <div className="err">{dis.err}</div>
           : dis.length===0 ? <div className="muted" style={{fontSize:12.5}}>제외한 항목이 없습니다.</div>
           : <table className="hc-table"><tbody>
              {dis.map(x=>(<tr key={x.id}>
                <td className="hc-who">{x.label||'(내용 없음)'}</td>
                <td className="hc-what">
                  <div>{x.check_label}{x.note?` · 사유: ${x.note}`:''}</div>
                  <div className="hc-why" style={{color:x.still_matching?'#e0a23c':'#7dc4a0'}}>
                    {x.still_matching?'지금도 이 문제에 해당합니다 (제외 중)':'지금은 해당 없음 — 되돌려도 진단에 안 뜹니다'}
                  </div>
                </td>
                <td className="hc-when">{x.dismissed_at}<br/><span className="muted">{x.by||''}</span></td>
                <td className="hc-act"><button className="hc-okbtn" onClick={()=>restoreOne(x)}>↩ 되돌리기</button></td>
              </tr>))}
             </tbody></table>}
        </div>}
       </>}
    </>}
  </div>);
}

function SnapshotPanel({sb}){
  const [snaps,setSnaps]=useState(null);
  const [busy,setBusy]=useState('');
  const [open,setOpen]=useState(false);
  async function load(){
    const {data}=await sb.from('crm_snapshots').select('id,taken_at,label,size_kb').order('taken_at',{ascending:false});
    setSnaps(data||[]);
  }
  useEffect(()=>{ if(open&&snaps===null) load(); },[open]);
  const fmt=s=>{ const d=new Date(s); return isNaN(d)?'-':`${d.getMonth()+1}.${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  async function backupNow(){
    setBusy('backup');
    const ok=await snapshotNow(sb,'수동');
    setBusy(''); if(ok){ await load(); } else alert('백업 실패 — 잠시 후 다시 시도하세요.');
  }
  async function download(id){
    setBusy('dl'+id);
    const {data,error}=await sb.from('crm_snapshots').select('taken_at,tables').eq('id',id).single();
    setBusy('');
    if(error||!data){ alert('불러오기 실패'); return; }
    const blob=new Blob([JSON.stringify({exported_at:data.taken_at,app:'GYMLORD CRM',tables:data.tables})],{type:'application/json'});
    const u=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=u; a.download=`gymlord_백업_${ymd(new Date(data.taken_at))}.json`; a.click(); URL.revokeObjectURL(u);
    markBackup();
    logAct(sb,'백업 내려받기',`스냅샷 ${ymd(new Date(data.taken_at))}`);   // 다른 기기에서도 최근 백업으로 인식되게
  }
  async function restore(s){
    if(!confirm(`⚠️ ${fmt(s.taken_at)} (${s.label||'-'}) 시점으로 되돌립니다.\n\n· 지금의 회원·회원권·수업·결제·락커·상품 데이터가 이 시점 상태로 전부 교체됩니다.\n· 이후 추가·수정한 내용은 사라집니다.\n· (복원 직전 현재 상태는 자동으로 한 장 백업됩니다.)\n\n계속할까요?`)) return;
    if(!confirm('정말 복원할까요? 이 작업은 전체 데이터를 교체합니다.')) return;
    setBusy('rs'+s.id);
    // 되돌리기용 안전망. ★실패하면 복원을 중단한다 —
    //   안전망 없이 복원하면 지금 데이터를 되돌릴 수단이 아예 사라진다.
    const safe=await snapshotNow(sb,'복원 전');
    if(!safe){
      setBusy('');
      alert('복원 전 안전 백업에 실패했습니다.\n\n지금 복원하면 현재 데이터를 되돌릴 수단이 없어서 중단했습니다.\n잠시 후 다시 시도하거나, 먼저 파일 백업을 받아두세요.');
      return;
    }
    const {data,error}=await sb.rpc('restore_crm_snapshot',{p_id:s.id});
    setBusy('');
    if(error){ alert('복원 실패: '+error.message); return; }
    logAct(sb,'스냅샷 복원',`${fmt(s.taken_at)} (${s.label||'-'})`);
    alert('복원 완료: '+(data||'')+'\n화면을 새로고침합니다.');
    location.reload();
  }
  return (<div className="mp-cardbox" style={{marginBottom:16}}>
    <h3 style={{cursor:'pointer'}} onClick={()=>setOpen(o=>!o)}>
      <span>🛡 자동 백업 · 복원</span>
      <span className="muted" style={{textTransform:'none',letterSpacing:0,fontWeight:600}}>{open?'▲':'▼'} {snaps?`${snaps.length}장`:''}</span>
    </h3>
    {open && <>
      <p className="muted" style={{fontSize:12.5,margin:'0 0 10px'}}>매일 첫 접속 시, 그리고 삭제 직전에 전체 데이터가 자동 저장됩니다(30일 보관). 사고 시 아래에서 되돌리거나 파일로 내려받을 수 있어요.</p>
      <button className="btn ghost sm" disabled={!!busy} onClick={backupNow} style={{marginBottom:12}}>{busy==='backup'?'백업 중...':'+ 지금 백업'}</button>
      {snaps===null? <div className="muted">불러오는 중...</div> :
       snaps.length===0? <div className="muted">아직 백업이 없습니다. 접속만 해도 하루 1장 자동 생성됩니다.</div> :
       <div className="list">
         <div className="row snaprow head"><div>시각</div><div>종류</div><div>크기</div><div>작업</div></div>
         {snaps.map(s=>(<div className="row snaprow" key={s.id} style={{cursor:'default'}}>
           <div className="muted" style={{fontSize:13}}>{fmt(s.taken_at)}</div>
           <div><span className={'logtag'+(s.label==='삭제 전'?' danger':s.label==='복원 전'?'':' ok')}>{s.label||'-'}</span></div>
           <div className="muted" style={{fontSize:13}}>{s.size_kb?s.size_kb+'KB':'-'}</div>
           <div style={{display:'flex',gap:6}}>
             <button className="btn ghost sm" disabled={!!busy} onClick={()=>download(s.id)}>{busy==='dl'+s.id?'...':'⤓'}</button>
             <button className="btn ghost sm" style={{color:'#e0a23c',borderColor:'#5a4a28'}} disabled={!!busy} onClick={()=>restore(s)}>{busy==='rs'+s.id?'복원 중...':'↺ 복원'}</button>
           </div>
         </div>))}
       </div>}
    </>}
  </div>);
}

function LogsView({sb,onOpenMember}){
  const [rows,setRows]=useState(null);
  const [q,setQ]=useState('');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[actor,setActor]=useState('');
  const [backing,setBacking]=useState(false);
  async function load(){ const {data}=await sb.from('logs').select('*').order('at',{ascending:false}).limit(500); setRows(data||[]); }
  // 전체 백업: 모든 테이블을 JSON 파일 하나로 다운로드 (복원·보관용)
  async function backupAll(){
    setBacking(true);
    try{
      const tables=await dumpAllTables(sb);   // 전체 테이블(신규 노트·할일·정산율 포함)
      const dump={exported_at:new Date().toISOString(), app:'GYMLORD CRM', tables};
      const blob=new Blob([JSON.stringify(dump)],{type:'application/json'});
      const u=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=u; a.download=`gymlord_백업_${ymd(new Date())}.json`; a.click(); URL.revokeObjectURL(u);
      markBackup();
      logAct(sb,'전체 백업',Object.entries(tables).map(([k,v])=>`${k} ${v.length}`).join(', '));
    }catch(e){ alert('백업 실패: '+e.message); }
    setBacking(false);
  }
  useEffect(()=>{ load(); },[]);
  const fmtLog=s=>{ const d=new Date(s); return isNaN(d)?'-':`${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const actors=useMemo(()=>[...new Set((rows||[]).map(r=>r.actor).filter(Boolean))].sort(),[rows]);
  const filtered=(rows||[]).filter(r=>{
    if(actor && r.actor!==actor) return false;
    const day=(r.at||'').slice(0,10);
    if(from && day<from) return false;
    if(to && day>to) return false;
    if(!q.trim()) return true;
    const s=`${r.action||''} ${r.detail||''} ${r.actor||''}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every(w=>s.includes(w));
  });
  const anyFilter=q.trim()||actor||from||to;
  const dsb=useDaysSinceBackup(sb);
  return (<div>
    {(dsb===null||dsb>=7) && <div className="backup-remind">
      <span>💾 {dsb===null?'아직 파일로 백업한 적이 없어요.':`마지막 파일 백업이 ${dsb}일 전이에요.`} 주 1회 파일 백업을 PC에 보관하는 걸 권장합니다.</span>
      <button className="btn sm" disabled={backing} onClick={backupAll}>{backing?'백업 중...':'⤓ 지금 백업'}</button>
    </div>}
    <HealthPanel sb={sb} onOpenMember={onOpenMember}/>
    <SnapshotPanel sb={sb}/>
    <div className="bar" style={{marginTop:18,flexWrap:'wrap'}}>
      <input className="search" placeholder="로그 검색 — 예: 강수빈 / 삭제 / 락커 / 미수금" value={q} onChange={e=>setQ(e.target.value)}/>
      <input type="date" value={from} onChange={e=>setFrom(e.target.value)} title="시작일" className="logfilter"/>
      <span className="muted">~</span>
      <input type="date" value={to} onChange={e=>setTo(e.target.value)} title="종료일" className="logfilter"/>
      <select value={actor} onChange={e=>setActor(e.target.value)} className="logfilter">
        <option value="">직원 전체</option>
        {actors.map(a=><option key={a} value={a}>{(a||'').split('@')[0]}</option>)}
      </select>
      {anyFilter && <button className="btn ghost sm" onClick={()=>{setQ('');setFrom('');setTo('');setActor('');}}>필터 초기화</button>}
      <button className="btn ghost sm" onClick={load}>새로고침</button>
      <button className="btn ghost sm" disabled={backing} onClick={backupAll}>{backing?'백업 중...':'⤓ 전체 백업'}</button>
    </div>
    {rows!==null && <div className="muted" style={{fontSize:13,marginBottom:10}}>{anyFilter? `필터 결과 ${filtered.length}건` : `최근 ${rows.length}건`} <span style={{opacity:.7}}>· 최근 500건까지 표시{dsb!==null?` · 마지막 파일 백업 ${dsb===0?'오늘':dsb+'일 전'}`:''}</span></div>}
    {rows===null? <div className="empty">불러오는 중...</div> :
     filtered.length===0? <div className="empty">{q.trim()?'검색 결과가 없습니다':'아직 기록된 로그가 없습니다. 앞으로의 작업(등록·수정·삭제 등)이 자동 기록됩니다.'}</div> :
     <div className="list" style={{marginBottom:40}}>
       <div className="row logrow head"><div>일시</div><div>작업</div><div>내용</div><div>작업자</div></div>
       {filtered.map(r=>(
         <div className="row logrow" key={r.id} style={{cursor:'default'}}>
           <div className="muted" style={{fontSize:13}}>{fmtLog(r.at)}</div>
           <div><span className={'logtag'+(/(삭제|노쇼)/.test(r.action||'')?' danger':/(등록|배정|수납|추가)/.test(r.action||'')?' ok':'')}>{r.action}</span></div>
           <div style={{fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.detail||''}>{r.detail||'-'}</div>
           <div className="muted" style={{fontSize:13,overflow:'hidden',textOverflow:'ellipsis'}} title={r.actor||''}>{(r.actor||'').split('@')[0]||'-'}</div>
         </div>))}
     </div>}
  </div>);
}

// ---------- 직원 권한 관리 (마스터 전용) ----------
function StaffAdmin({sb}){
  const {email:myEmail}=usePerm();
  const [rows,setRows]=useState(null);
  const [err,setErr]=useState('');
  const [adding,setAdding]=useState(false);
  async function load(){
    const {data,error}=await sb.from('staff').select('*').order('role').order('name');
    if(error){ setErr('직원 목록 조회 실패: '+error.message); setRows([]); return; }
    setErr(''); setRows(data||[]);
  }
  useEffect(()=>{ load(); },[]);

  async function patch(row, changes, logMsg){
    const {error}=await sb.from('staff').update(changes).eq('id',row.id);
    if(error){ setErr('저장 실패: '+error.message); return; }
    logAct(sb,'권한 변경',`${row.name||row.email} · ${logMsg}`);
    setRows(rs=>rs.map(r=>r.id===row.id?{...r,...changes}:r));
  }
  function togglePerm(row,key,val){ patch(row,{perms:{...(row.perms||{}),[key]:val}}, `${PERM_LABELS[key]} ${val?'허용':'제한'}`); }
  function setRole(row,role){
    if(row.email===myEmail && role!=='master' && !confirm('본인 계정을 프리랜서로 내리면 권한 탭 접근을 잃습니다. 계속할까요?')) return;
    patch(row,{role}, `역할 ${role==='master'?'마스터':'프리랜서'}`);
  }
  async function removeRow(row){
    if(!confirm(`${row.name||row.email} 직원 권한 행을 삭제할까요?\n※ Supabase 로그인 계정은 대시보드에서 별도 삭제해야 합니다.`)) return;
    const {error}=await sb.from('staff').delete().eq('id',row.id);
    if(error){ setErr('삭제 실패: '+error.message); return; }
    logAct(sb,'권한 변경',`${row.name||row.email} · 직원 삭제`);
    setRows(rs=>rs.filter(r=>r.id!==row.id));
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',marginBottom:6}}>
        <h2 style={{margin:0}}>직원 권한</h2>
        <button className="btn sm" onClick={()=>setAdding(true)}>＋ 직원 추가</button>
      </div>
      <p className="muted" style={{marginTop:0,fontSize:13}}>마스터는 전 기능 접근. 프리랜서는 체크리스트로 기능별 접근을 허용/제한합니다. (로그인 계정·비밀번호는 Supabase 대시보드에서 생성, 여기선 권한만 관리)</p>
      {err && <div className="err">{err}</div>}
      {rows===null? <div className="empty">불러오는 중...</div> :
       rows.length===0? <div className="empty">등록된 직원이 없습니다. staff 테이블 SQL을 먼저 실행하세요.</div> :
       <div className="stafflist">
         {rows.map(row=>(
           <div key={row.id} className={'staffcard'+(row.active?'':' off')}>
             <div className="staffcard-head">
               <div className="staffcard-id"><b>{row.name||row.email.split('@')[0]}</b><span className="muted">{row.email}</span></div>
               <div className="staffcard-actions">
                 <select value={row.role} onChange={e=>setRole(row,e.target.value)}>
                   <option value="master">마스터</option>
                   <option value="trainer">프리랜서</option>
                 </select>
                 <label className="chk"><input type="checkbox" checked={row.active} onChange={e=>patch(row,{active:e.target.checked}, e.target.checked?'활성화':'비활성화')}/> 활성</label>
                 <button className="link danger" onClick={()=>removeRow(row)}>삭제</button>
               </div>
             </div>
             {row.role==='master'
               ? <div className="muted" style={{fontSize:13}}>전체 권한 (모든 탭·기능)</div>
               : <div className="permgrid">
                   {PERM_KEYS.map(k=>(
                     <label key={k} className={'permchk'+((row.perms&&row.perms[k])?' on':'')}>
                       <input type="checkbox" checked={!!(row.perms&&row.perms[k])} onChange={e=>togglePerm(row,k,e.target.checked)}/>
                       {PERM_LABELS[k]}
                     </label>))}
                 </div>}
           </div>))}
       </div>}
      {adding && <StaffAddModal sb={sb} onClose={()=>setAdding(false)} onSaved={()=>{setAdding(false);load();}}/>}
    </div>
  );
}

// 직원 권한 행 추가 (로그인 계정은 대시보드에서 별도 생성)
function StaffAddModal({sb,onClose,onSaved}){
  useEsc(onClose);
  const [email,setEmail]=useState(''),[name,setName]=useState(''),[role,setRole]=useState('trainer');
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function save(){
    const em=email.trim().toLowerCase();
    if(!em){ setErr('이메일을 입력하세요 (Supabase 로그인 계정과 동일하게).'); return; }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){ setErr('이메일 형식이 아닙니다. 이름은 표시명 칸에, 여기엔 로그인 이메일을 입력하세요.'); return; }
    setBusy(true);
    const perms = role==='trainer'? DEFAULT_TRAINER_PERMS : {};
    const {error}=await sb.from('staff').insert({email:em,name:name.trim()||null,role,perms,active:true});
    setBusy(false);
    if(error){ setErr('저장 실패: '+error.message); return; }
    logAct(sb,'권한 변경',`${name.trim()||em} · 직원 추가(${role==='master'?'마스터':'프리랜서'})`);
    onSaved();
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>직원 추가</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <p className="muted" style={{fontSize:12,marginTop:0}}>Supabase 대시보드에서 만든 로그인 계정의 <b>이메일과 동일</b>하게 입력하세요. 여기서는 권한만 등록됩니다.</p>
      <div className="field"><label>이메일</label><input autoFocus value={email} onChange={e=>setEmail(e.target.value)} placeholder="예: kyurin@gymlord.kr"/></div>
      <div className="field"><label>표시명</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="예: 김규린"/></div>
      <div className="field"><label>역할</label>
        <div className="seg">
          <button type="button" className={role==='trainer'?'on':''} onClick={()=>setRole('trainer')}>프리랜서</button>
          <button type="button" className={role==='master'?'on':''} onClick={()=>setRole('master')}>마스터</button>
        </div></div>
      <button className="btn" disabled={busy} onClick={save}>{busy?'저장 중...':'추가'}</button>
      <div className="err">{err}</div>
    </div></div>
  );
}

// ---------- 개인정보 처리방침 ----------
const PRIVACY_POLICY = `짐로드(이하 "센터")는 「개인정보 보호법」에 따라 회원의 개인정보를 보호하고 관련 고충을 신속히 처리하기 위해 다음과 같이 개인정보 처리방침을 둡니다.

1. 수집하는 개인정보 항목
 · 필수: 이름, 연락처(휴대전화)
 · 선택: 성별, 생년월일, 주소, 결제·회원권 이용내역

2. 개인정보의 수집·이용 목적
 · 회원 관리 및 본인 확인
 · 회원권·PT 이용 등록 및 이용내역 관리
 · 요금 결제·정산 및 미수금 관리
 · 만료·예약 등 이용 관련 안내(선택 동의 시 마케팅 정보 제공)

3. 개인정보의 보유·이용 기간
 · 회원 탈퇴 또는 수집·이용 목적 달성 시 지체 없이 파기합니다.
 · 다만 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 다음의 기록은 보관합니다.
   - 계약·청약철회, 대금결제 및 재화 등의 공급에 관한 기록: 5년

4. 개인정보의 파기 절차 및 방법
 · 전자적 파일: 복구가 불가능한 방법으로 영구 삭제
 · 종이 문서: 분쇄 또는 소각
 · 보유기간 경과 또는 정보주체의 동의 철회 시 지체 없이 파기합니다.

5. 정보주체의 권리
 · 회원은 언제든지 본인의 개인정보에 대한 열람·정정·삭제·처리정지를 요청할 수 있습니다.
 · 요청은 아래 문의처로 하실 수 있습니다.

6. 개인정보 제3자 제공
 · 센터는 회원의 개인정보를 외부에 제공하지 않습니다.
   (결제 처리 등 불가피한 경우 해당 업무 범위 내에서만 처리합니다)

7. 개인정보 보호책임자 및 문의처
 · 상호: 짐로드
 · 대표자: 서민기
 · 소재지: 서울 강남구 청담동 32-5
 · 문의: alsrl229@naver.com

시행일: 2026-07-14`;

function PrivacyModal({onClose}){
  useEsc(onClose);
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" style={{maxWidth:640}} onClick={e=>e.stopPropagation()}>
      <div className="mhead"><h3>개인정보 처리방침</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      <div style={{maxHeight:'70vh',overflowY:'auto',whiteSpace:'pre-wrap',fontSize:13,lineHeight:1.75,color:'var(--cream)'}}>{PRIVACY_POLICY}</div>
    </div></div>
  );
}

// ---------- App ----------
// 네비 라인 아이콘 (currentColor 상속 → 활성시 브라스)
const _ni={viewBox:'0 0 24 24',width:19,height:19,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round'};
// ---------- 동의서 서명 페이지 (로그인 불필요 · 1회용 토큰 · RPC로만 접근) ----------
function ConsentSignPage({token}){
  const [sb]=useState(()=>{
    const c=getClient(); if(c) return c;
    try{ const m=(location.hash||'').match(/cfg=([A-Za-z0-9+/=]+)/); if(m){ const [u,k]=atob(m[1]).split('|'); if(/^https?:\/\//i.test(u)&&k) return createClient(u,k); } }catch(e){}
    return null;
  });
  const [info,setInfo]=useState(null); // null=로딩, 'bad'=무효, {masked_name, already_signed}
  const [agree,setAgree]=useState(false),[mkt,setMkt]=useState(false);
  const [busy,setBusy]=useState(false),[done,setDone]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{ if(!sb){ setInfo('bad'); return; }
    sb.rpc('consent_link_info',{p_token:token}).then(({data,error})=>{
      setInfo(error||!data||!data.length ? 'bad' : data[0]);
    }).catch(()=>setInfo('bad'));
  },[]);
  async function sign(){
    if(!agree){ setErr('필수 동의 항목에 체크해주세요.'); return; }
    setBusy(true); setErr('');
    const {data,error}=await sb.rpc('sign_consent',{p_token:token,p_marketing:mkt});
    setBusy(false);
    if(error||!data){ setErr('처리하지 못했습니다. 링크가 만료됐거나 이미 사용되었습니다.'); return; }
    setDone(true);
  }
  const box={maxHeight:220,overflowY:'auto',whiteSpace:'pre-wrap',fontSize:12.5,lineHeight:1.65,background:'var(--forest)',border:'1px solid var(--line)',borderRadius:10,padding:'12px 14px',color:'var(--muted)',textAlign:'left'};
  return (
    <div className="center gl-scene"><GLMonogram size={520} opacity={.05} color="#B08D57"/><div className="panel gl-panel" style={{maxWidth:520}}>
      <div className="gl-crest"><GLMonogram size={54} stroke={1.2} opacity={.9}/></div>
      <div className="logo gl-logo-center">GYMLORD<small>개인정보 수집·이용 동의</small></div>
      <Ornament/>
      {info===null? <div className="muted" style={{padding:'30px 0',textAlign:'center'}}>불러오는 중...</div> :
       info==='bad'? <div className="muted" style={{padding:'26px 0',textAlign:'center'}}>유효하지 않은 링크입니다.<br/>링크가 만료됐거나 이미 사용되었습니다.<br/>센터에 새 링크를 요청해주세요.</div> :
       (done||info.already_signed)? <div style={{padding:'26px 0',textAlign:'center'}}><div style={{fontSize:38,marginBottom:10}}>✅</div><b>동의가 완료되었습니다</b><div className="muted" style={{marginTop:8,fontSize:13}}>이 창은 닫으셔도 됩니다. 감사합니다.</div></div> :
       <>
        <p style={{fontSize:14,margin:'6px 0 10px'}}><b>{info.masked_name}</b> 회원님, 아래 내용을 확인하고 동의해주세요.</p>
        <div style={box}>{PRIVACY_POLICY}</div>
        <label className="chk" style={{marginTop:12}}><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)}/> (필수) 개인정보 수집·이용에 동의합니다</label>
        <label className="chk" style={{marginTop:6}}><input type="checkbox" checked={mkt} onChange={e=>setMkt(e.target.checked)}/> (선택) 마케팅 정보 수신에 동의합니다</label>
        <button className="btn" style={{marginTop:14,width:'100%'}} disabled={busy} onClick={sign}>{busy?'처리 중...':'동의합니다'}</button>
        <div className="err">{err}</div>
       </>}
    </div></div>
  );
}

// ---------- 통합 검색 (사이드바) ----------
function GlobalSearch({sb,onPick}){
  const [q,setQ]=useState('');
  const [res,setRes]=useState(null);
  const timer=useRef();
  const box=useRef();
  useEffect(()=>{
    clearTimeout(timer.current);
    const raw=q.trim().replace(/[,%()*]/g,' ').trim();
    if(!raw){ setRes(null); return; }
    timer.current=setTimeout(async()=>{
      const digits=raw.replace(/\D/g,'');
      let query=sb.from('members').select('id,name,phone,status,assigned_trainer,birth,gender,address,memo,tags,reg_date,manager,consent_at,consent_marketing,cumulative_payment').order('name').limit(8);
      if(digits.length>=2 && /^[0-9]+$/.test(raw.replace(/\s/g,''))) query=query.ilike('phone',`%${digits}%`);
      else query=query.or(`name.ilike.%${raw}%,phone.ilike.%${digits||raw}%`);
      const {data}=await query;
      setRes(data||[]);
    },250);
  },[q]);
  useEffect(()=>{ const h=e=>{ if(box.current && !box.current.contains(e.target)) setRes(null); };
    document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  return (<div className="gsearch" ref={box}>
    <input value={q} onChange={e=>setQ(e.target.value)} placeholder="회원 검색 (이름·전화)"
      onKeyDown={e=>{ if(e.key==='Escape'){ setQ(''); setRes(null); } if(e.key==='Enter'&&res&&res.length){ onPick(res[0]); setQ(''); setRes(null); } }}/>
    {res!==null && <div className="gsearch-res">
      {res.length===0? <div className="gsearch-empty">검색 결과 없음</div> :
        res.map(m=>(<button key={m.id} className="gsearch-item" onClick={()=>{ onPick(m); setQ(''); setRes(null); }}>
          <b>{m.name}</b>
          <small>{m.phone||'-'}{m.assigned_trainer?' · '+m.assigned_trainer:''}</small>
        </button>))}
    </div>}
  </div>);
}

// ---------- 비밀번호 변경 (직원 셀프) ----------
function PasswordModal({sb,onClose}){
  useEsc(onClose);
  const [pw,setPw]=useState(''),[pw2,setPw2]=useState('');
  const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[done,setDone]=useState(false);
  async function save(){
    if(pw.length<6){ setErr('비밀번호는 6자 이상이어야 합니다.'); return; }
    if(pw!==pw2){ setErr('두 비밀번호가 일치하지 않습니다.'); return; }
    setBusy(true); setErr('');
    const {error}=await sb.auth.updateUser({password:pw});
    setBusy(false);
    if(error){ setErr('변경 실패: '+error.message); return; }
    setDone(true);
  }
  return (
    <div className="modal-ov" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
      <div className="mhead"><h3>비밀번호 변경</h3><button className="xbtn" onClick={onClose}>✕</button></div>
      {done? <div style={{padding:'16px 0',textAlign:'center'}}><div style={{fontSize:34,marginBottom:8}}>✅</div><b>변경되었습니다</b>
        <div className="muted" style={{fontSize:13,marginTop:6}}>다음 로그인부터 새 비밀번호를 사용하세요.</div>
        <button className="btn" style={{marginTop:14,width:'100%'}} onClick={onClose}>닫기</button></div> : <>
        <p className="muted" style={{fontSize:12,marginTop:0}}>본인 로그인 계정의 비밀번호를 바꿉니다.</p>
        <div className="field"><label>새 비밀번호</label><input type="password" autoFocus value={pw} onChange={e=>setPw(e.target.value)} placeholder="6자 이상"/></div>
        <div className="field"><label>새 비밀번호 확인</label><input type="password" value={pw2} onChange={e=>setPw2(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter') save(); }} placeholder="한 번 더 입력"/></div>
        <button className="btn" style={{width:'100%'}} disabled={busy} onClick={save}>{busy?'변경 중...':'변경'}</button>
        <div className="err">{err}</div>
      </>}
    </div></div>
  );
}

const NAV_ICONS={
  home:(<svg {..._ni}><path d="M3 11.4 12 4l9 7.4"/><path d="M5.6 9.9V20h12.8V9.9"/><path d="M9.8 20v-5.6h4.4V20"/></svg>),
  members:(<svg {..._ni}><circle cx="12" cy="7.8" r="3.6"/><path d="M4.6 20c.7-4.1 3.7-6.1 7.4-6.1s6.7 2 7.4 6.1"/></svg>),
  calendar:(<svg {..._ni}><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.7h17M8.4 3v4M15.6 3v4"/></svg>),
  lockers:(<svg {..._ni}><circle cx="8.3" cy="12" r="3.7"/><path d="M12 12h8.5M16.8 12v3.3M20.5 12v2.4"/></svg>),
  sales:(<svg {..._ni}><rect x="2.8" y="6.4" width="18.4" height="11.2" rx="1.8"/><circle cx="12" cy="12" r="2.6"/><path d="M6.1 12h.01M17.9 12h.01"/></svg>),
  products:(<svg {..._ni}><path d="M11.9 3.5H5.7A2.2 2.2 0 0 0 3.5 5.7v6.2c0 .58.23 1.14.64 1.55l7.4 7.4a2.2 2.2 0 0 0 3.1 0l6.2-6.2a2.2 2.2 0 0 0 0-3.1l-7.4-7.4a2.2 2.2 0 0 0-1.54-.65Z"/><circle cx="8.2" cy="8.2" r="1.25"/></svg>),
  stats:(<svg {..._ni}><path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.4" y="12" width="3.2" height="5.4" rx="1"/><rect x="12.4" y="8.4" width="3.2" height="9" rx="1"/><rect x="17.4" y="10.4" width="3.2" height="7" rx="1"/></svg>),
  logs:(<svg {..._ni}><rect x="4.6" y="4" width="14.8" height="17" rx="2"/><path d="M8.6 9.2h6.8M8.6 13h6.8M8.6 16.8h4.2"/></svg>),
  staff:(<svg {..._ni}><path d="M12 3.2l6.5 2.4v5.1c0 4.1-2.7 7.2-6.5 8.3-3.8-1.1-6.5-4.2-6.5-8.3V5.6L12 3.2Z"/><path d="M9.3 11.7l1.9 1.9 3.5-3.7"/></svg>),
};
function App(){
  const [sb]=useState(getClient);
  const [authed,setAuthed]=useState(null);
  // 관리도구가 `?import=1`로 열면 홈이 아니라 캘린더로 바로 들어간다(가져오기 모달이 거기서 열린다)
  const [view,setView]=useState(()=> /[?&]import=1/.test(location.search) ? 'calendar' : 'home');
  const [me,setMe]=useState(null); // 내 staff 행 {role,perms,email,name}
  const [showPolicy,setShowPolicy]=useState(false);
  const [showPw,setShowPw]=useState(false);
  const [globalSel,setGlobalSel]=useState(null); // 통합 검색으로 연 회원
  // ★세션을 처음 한 번만 확인하면, 데스크에 열어둔 채로 세션이 끊겼을 때
  //   화면은 로그인된 상태로 남고 모든 조회가 실패한다 → 회원 0명·매출 0원으로 보여
  //   "데이터가 날아갔다"고 오해하게 된다. onAuthStateChange로 로그아웃을 즉시 반영한다.
  useEffect(()=>{
    if(!sb) return;
    sb.auth.getSession().then(({data})=>setAuthed(!!data.session));
    const {data:sub}=sb.auth.onAuthStateChange((_evt,session)=>{ setAuthed(!!session); if(!session) setMe(null); });
    return ()=>{ try{ sub.subscription.unsubscribe(); }catch(e){} };
  },[]);
  useEffect(()=>{ if(authed && sb) maybeDailySnapshot(sb); },[authed]);
  useEffect(()=>{
    if(!authed || !sb){ setMe(null); return; }
    (async()=>{
      let email='';
      try{ const {data}=await sb.auth.getUser(); email=(data&&data.user&&data.user.email)||''; }catch(e){}
      if(OWNER_EMAILS.includes(email)){ setMe({role:'master',perms:{},email,name:'서민기'}); return; }
      let row=null;
      // active=true 조건 필수 — 빼면 퇴사 처리(active=false)한 직원이 UI에서 예전 권한을
      // 그대로 보게 된다(데이터는 RLS가 막지만 빈 화면만 보여 혼란). 서버 판정과 일치시킨다.
      try{ const {data}=await sb.from('staff').select('*').eq('email',email).eq('active',true).maybeSingle(); row=data; }catch(e){}
      setMe(row || {role:'trainer',perms:DEFAULT_TRAINER_PERMS,email,name:email?email.split('@')[0]:''});
    })();
  },[authed]);
  async function logout(){ await sb.auth.signOut(); setMe(null); setAuthed(false); }
  // 자가진단 상세에서 회원 이름 클릭 → 회원 상세 모달 열기.
  // 진단 RPC는 마스터 권한(DEFINER)으로 집계하므로, 여기서 회원을 다시 조회할 때는
  // 일반 RLS를 그대로 탄다(= 볼 수 없는 회원이면 안내 후 중단).
  async function openMemberById(id){
    if(!id) return;
    const {data}=await sb.from('members').select('*').eq('id',id).maybeSingle();
    if(!data){ alert('이 회원을 열 수 없습니다. (삭제됐거나 접근 권한이 없습니다)'); return; }
    setGlobalSel(data);
  }
  // 동의서 서명 링크(?consent=토큰)로 진입 시: 로그인 게이트 앞에서 서명 페이지 표시
  const consentTok=new URLSearchParams(location.search).get('consent');
  if(consentTok) return <ConsentSignPage token={consentTok}/>;
  if(!sb) return <Setup onDone={()=>location.reload()}/>;
  if(authed===null) return <div className="center"><div className="muted">불러오는 중...</div></div>;
  if(!authed) return <Login sb={sb} onIn={()=>setAuthed(true)}/>;
  if(me===null) return <div className="center"><div className="muted">불러오는 중...</div></div>;
  const isMaster = me.role==='master';
  const can = (key)=> isMaster ? true : !!(me.perms && me.perms[key]);
  const MENU=[
    ['home','홈',null],
    ['members','회원','members'],
    ['calendar','캘린더','calendar'],
    ['lockers','락커','lockers'],
    ['stats','수업통계','calendar'],   // 돈이 아니라 수업이 주제 → 캘린더 권한이면 볼 수 있다
    ['sales','매출','sales'],
    ['products','상품','products'],
    ['logs','로그','logs'],
    ['staff','권한','__master'],
  ];
  const menu = MENU.filter(([k,l,perm])=> perm===null || (perm==='__master'? isMaster : can(perm)));
  const allowed = new Set(menu.map(m=>m[0]));
  const shownView = allowed.has(view) ? view : 'home';
  return (
    <PermCtx.Provider value={{role:me.role, perms:me.perms||{}, can, email:me.email, name:me.name}}>
    <div className="shell">
      <aside className="side">
        <div className="logo logo-home" title="홈으로" onClick={()=>{ setView('home'); setGlobalSel(null); }}>GYMLORD<small>MEMBER OS</small></div>
        <div className="side-orn"><Ornament width={96}/></div>
        {can('members') && <GlobalSearch sb={sb} onPick={setGlobalSel}/>}
        <nav className="side-nav">
          {menu.map(([k,lbl])=>(
            <button key={k} className={'nav-it'+(shownView===k?' on':'')} onClick={()=>{ setView(k); setGlobalSel(null); }}>
              <span className="nav-ic">{NAV_ICONS[k]}</span>{lbl}
            </button>))}
        </nav>
        <div className="side-spacer"/>
        <div className="side-me">{me.name||me.email}<small>{isMaster?'마스터':'프리랜서'}</small></div>
        {/* side-links: 모바일에서는 숨긴다 — 하단 탭바에 남으면 메뉴 8개를 밀어내 버튼이 19px이 된다.
            ★display를 인라인 style로 주면 미디어쿼리가 못 이긴다. 스타일은 CSS(.side-links)에 둔다. */}
        <div className="side-links">
          <button className="link" style={{margin:0,fontSize:12}} onClick={()=>setShowPw(true)}>비밀번호 변경</button>
          <button className="link" style={{margin:0,fontSize:12}} onClick={()=>setShowPolicy(true)}>개인정보 처리방침</button>
        </div>
        <button className="btn ghost sm" style={{width:'100%'}} onClick={logout}>로그아웃</button>
      </aside>
      {/* ★모바일 우상단 원형 로그아웃 버튼은 없앴다 — 통합검색 바로 옆이라 실수로 눌러
          작업 중 로그아웃되는 사고가 났다. 로그아웃은 홈 화면 맨 아래 텍스트 버튼으로 옮겼다. */}
      <main className="main">
        {shownView==='home'? <DashboardView sb={sb} onNav={setView} onLogout={logout}/> :
         shownView==='members'? <MembersView sb={sb}/> :
         shownView==='calendar'? <CalendarView sb={sb}/> :
         shownView==='lockers'? <LockersView sb={sb}/> :
         shownView==='stats'? <LessonStatsView sb={sb}/> :
         shownView==='sales'? <SalesView sb={sb}/> :
         shownView==='products'? <ProductsView sb={sb}/> :
         shownView==='staff'? <StaffAdmin sb={sb}/> : <LogsView sb={sb} onOpenMember={openMemberById}/>}
      </main>
      {showPolicy && <PrivacyModal onClose={()=>setShowPolicy(false)}/>}
      {showPw && <PasswordModal sb={sb} onClose={()=>setShowPw(false)}/>}
      {globalSel && <Detail key={globalSel.id} sb={sb} member={globalSel} onClose={()=>setGlobalSel(null)}/>}
    </div>
    </PermCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
