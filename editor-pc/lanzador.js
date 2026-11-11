/* GS · Lanzador flotante de la suite: un botón pequeño que abre las demás apps en una ventana nueva, sin cerrar la actual. */
(function () {
  'use strict';
  if (window.__gsLanzador || window.top !== window.self || window.Native) return;
  /* Solo en computador: en celular y tablet no se muestra */
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|CriOS/i.test(navigator.userAgent || '') || !(window.matchMedia && matchMedia('(pointer:fine)').matches)) return;
  window.__gsLanzador = true;
  const APPS = [
    { id: 'diag', n: 'GS Diagnósticos', i: '🧭', u: 'https://gsdiagnosticosapp.vercel.app/' },
    { id: 'cal', n: 'GS Calidad Técnica', i: '✅', u: 'https://calidad-tecnica-espt.vercel.app/' },
    { id: 'ap', n: 'GS Alumbrado Público', i: '💡', u: 'https://alumbradopublico.vercel.app/' },
    { id: 'docs', n: 'GS Docs', i: '📄', u: 'https://gsdocumentos.vercel.app/' },
    { id: 'firmas', n: 'GS Firmas', i: '✍️', u: 'https://gsdocumentos.vercel.app/gs-firmas/' },
    { id: 'editor', n: 'GS Editor', i: '🛠️', u: 'https://gsdocumentos-editor-pc.vercel.app/', pc: 1 },
    { id: 'studio', n: 'GS Studio', i: '📷', u: 'https://gsstudio.vercel.app/' },
  ];
    const isPC = !/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent || '');
  const here = location.href;
  let cur = null; APPS.forEach(a => { if (here.indexOf(a.u) === 0 && (!cur || a.u.length > cur.u.length)) cur = a; });
  const ss = { get() { try { return sessionStorage.getItem('gs.lz.off'); } catch (_) { return null; } }, set(v) { try { sessionStorage.setItem('gs.lz.off', v); } catch (_) { } } };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) { } } };

  const css = `
  #gsLz{position:fixed;z-index:2147482000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
  #gsLz{width:76px;height:76px;touch-action:none;cursor:grab}
  #gsLz:before,#gsLz:after{content:"";position:absolute;inset:0;border-radius:50%;background:rgba(121,209,255,.55);animation:gsLzWave 2.8s ease-out infinite;pointer-events:none}
  #gsLz:after{animation-delay:1.4s}
  @keyframes gsLzWave{0%{transform:scale(1);opacity:.65}100%{transform:scale(2.1);opacity:0}}
  @keyframes gsLzBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
  #gsLz .s{position:absolute;inset:0;border-radius:50%;background:rgba(121,209,255,.72);border:2px solid rgba(255,255,255,.75);box-shadow:0 6px 18px rgba(30,140,210,.35);animation:gsLzBeat 2.8s ease-in-out infinite}
  #gsLz.o:before,#gsLz.o:after{animation-play-state:paused;opacity:0}
  #gsLz .b{position:absolute;left:11px;top:11px;width:54px;height:54px;border-radius:17px;border:3px solid #ff6600;background:rgba(254,254,255,.96);padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,60,110,.3);touch-action:none;transition:transform .15s}
  #gsLz .b:hover,#gsLz.o .b{transform:scale(1.06)}
  #gsLz .b span.t{font:900 20px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.5px;color:#0b4f7a}
  #gsLz .b span.t i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#ff6600;margin-left:1px}
  @media (prefers-reduced-motion:reduce){#gsLz:before,#gsLz:after,#gsLz .s{animation:none}#gsLz:before,#gsLz:after{display:none}}
  #gsLz .m{position:absolute;width:min(300px,86vw);background:#fff;color:#14181d;border-radius:20px;box-shadow:0 16px 44px rgba(10,14,18,.4);padding:12px;display:none;overflow:hidden}
  #gsLz .m:before{content:"";position:absolute;left:0;right:0;top:0;height:5px;background:linear-gradient(90deg,#79d1ff,#ff6600)}
  #gsLz.o .m{display:block;animation:gsLzIn .14s ease-out}
  @keyframes gsLzIn{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}
  #gsLz .h{padding:4px 4px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  #gsLz .h b{font:800 14px system-ui,sans-serif;color:#14181d}
  #gsLz .h small{display:block;font:600 11px system-ui,sans-serif;color:#7b8794;margin-top:1px}
  #gsLz .h button{border:0;background:#eef1f4;color:#5b6773;font:700 11px system-ui,sans-serif;cursor:pointer;border-radius:99px;padding:6px 10px;white-space:nowrap}
  #gsLz .g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  #gsLz a{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:11px;border-radius:14px;background:#f6f8fa;border:1px solid #e6eaee;color:#14181d;text-decoration:none;font:700 13px/1.2 system-ui,sans-serif;position:relative;transition:background .12s,border-color .12s,transform .12s}
  #gsLz a span{font-size:22px;line-height:1}
  #gsLz a:hover,#gsLz a:focus{background:#fff2e8;border-color:#ff9a4d;transform:translateY(-1px);outline:0}
  #gsLz a.c{background:#ff6600;border-color:#ff6600;color:#fff;pointer-events:none}
  #gsLz a small{font-weight:700;font-size:10px;opacity:.85}
  @media print{#gsLz{display:none!important}}`;

  function build() {
    if (ss.get() === '1' || document.getElementById('gsLz')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'gsLz';
    const S = 76;
    let pos = (() => { try { return JSON.parse(ls.get('gs.lz.pos3') || ''); } catch (_) { return null; } })() || { x: 18, y: Math.round(innerHeight * .55) };
    const clamp = () => { pos.x = Math.min(Math.max(0, pos.x), innerWidth - S); pos.y = Math.min(Math.max(0, pos.y), innerHeight - S); };
    const place = () => { clamp(); root.style.left = pos.x + 'px'; root.style.top = pos.y + 'px'; };
    const sh = document.createElement('div'); sh.className = 's';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'b'; btn.innerHTML = '<span class="t">GS<i></i></span>'; btn.setAttribute('aria-label', 'Abrir otras apps de la suite GS'); btn.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div'); menu.className = 'm'; menu.setAttribute('role', 'menu');
    const apps = APPS.filter(a => !a.pc || isPC);
    menu.innerHTML = '<div class="h"><div><b>Suite GS</b><small>Se abre en ventana nueva</small></div><button type="button" data-hide>Ocultar</button></div><div class="g">' +
      apps.map(a => `<a role="menuitem" href="${a.u}" target="_blank" rel="noopener"${cur && cur.id === a.id ? ' class="c"' : ''}><span>${a.i}</span>${a.n}${cur && cur.id === a.id ? '<small>Estás aquí</small>' : ''}</a>`).join('') + '</div>';
    root.append(sh, btn, menu); document.body.appendChild(root); place();
    const isOpen = () => root.classList.contains('o');
    const close = () => { root.classList.remove('o'); btn.setAttribute('aria-expanded', 'false'); };
    const open = () => {
      const right = pos.x + S / 2 < innerWidth / 2, down = pos.y < innerHeight / 2;
      menu.style.left = right ? (S + 10) + 'px' : 'auto'; menu.style.right = right ? 'auto' : (S + 10) + 'px';
      menu.style.top = down ? '0' : 'auto'; menu.style.bottom = down ? 'auto' : '0';
      root.classList.add('o'); btn.setAttribute('aria-expanded', 'true');
    };
    let drag = null, moved = false;
    root.addEventListener('pointerdown', e => { if (menu.contains(e.target)) return; drag = { x0: e.clientX, y0: e.clientY, px: pos.x, py: pos.y }; moved = false; try { root.setPointerCapture(e.pointerId); } catch (_) { } });
    root.addEventListener('pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 6) { moved = true; close(); }
      if (moved) { pos.x = drag.px + dx; pos.y = drag.py + dy; place(); }
    });
    root.addEventListener('pointerup', e => {
      if (!drag) return; drag = null;
      if (moved) ls.set('gs.lz.pos3', JSON.stringify(pos));
      else if (!menu.contains(e.target)) (isOpen() ? close() : open());
    });
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isOpen() ? close() : open(); } });
    document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    menu.addEventListener('click', e => { if (e.target.closest('a')) setTimeout(close, 50); if (e.target.hasAttribute('data-hide')) { ss.set('1'); root.remove(); } });
    window.addEventListener('resize', place);
  }
  /* «Ocultar» solo lo oculta hasta que se cierre la ventana; al abrir la app de nuevo vuelve a aparecer. */
  window.GS_LANZADOR = { mostrar() { ss.set('0'); build(); }, ocultar() { ss.set('1'); const r = document.getElementById('gsLz'); if (r) r.remove(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true }); else build();
})();
