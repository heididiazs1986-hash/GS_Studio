/* GS · Lanzador flotante de la suite: un botón pequeño que abre las demás apps en una ventana nueva, sin cerrar la actual. */
(function () {
  'use strict';
  if (window.__gsLanzador || window.top !== window.self || window.Native) return;
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
  #gsLz .b{width:62px;height:62px;border-radius:50%;border:0;cursor:grab;touch-action:none;padding:0;opacity:.96;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;
    background:repeating-linear-gradient(176deg,rgba(255,255,255,.42) 0 1.5px,rgba(255,255,255,0) 1.5px 4px),repeating-linear-gradient(88deg,rgba(0,110,190,.16) 0 7px,rgba(0,110,190,0) 7px 16px),radial-gradient(circle at 30% 25%,#a9e3ff,#79d1ff 55%,#4cb5f0);
    box-shadow:0 0 0 2px rgba(255,255,255,.9),0 0 0 3.5px rgba(121,209,255,.85),0 10px 24px rgba(20,120,200,.4),0 2px 6px rgba(0,0,0,.2)}
  #gsLz .b:hover,#gsLz.o .b{opacity:1;transform:scale(1.07)}
  #gsLz .b .f{width:44px;height:44px;border-radius:14px;border:2.5px solid #ff6600;background:rgba(254,254,255,.55);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,60,110,.25)}
  #gsLz .b span.t{font:900 18px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.5px;color:#0b4f7a}
  #gsLz .b span.t i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#ff6600;margin-left:1px}
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
    const pos = (() => { try { return JSON.parse(ls.get('gs.lz.pos') || ''); } catch (_) { return null; } })() || { x: 6, y: Math.round(innerHeight * .55) };
    const place = () => { const x = Math.min(Math.max(0, pos.x), innerWidth - 62), y = Math.min(Math.max(0, pos.y), innerHeight - 62); root.style.left = x + 'px'; root.style.top = y + 'px'; return { x, y }; };
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'b'; btn.innerHTML = '<span class="f"><span class="t">GS<i></i></span></span>'; btn.setAttribute('aria-label', 'Abrir otras apps de la suite GS'); btn.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div'); menu.className = 'm'; menu.setAttribute('role', 'menu');
    const apps = APPS.filter(a => !a.pc || isPC);
    menu.innerHTML = '<div class="h"><div><b>Suite GS</b><small>Se abre en ventana nueva</small></div><button type="button" data-hide>Ocultar</button></div><div class="g">' +
      apps.map(a => `<a role="menuitem" href="${a.u}" target="_blank" rel="noopener"${cur && cur.id === a.id ? ' class="c"' : ''}><span>${a.i}</span>${a.n}${cur && cur.id === a.id ? '<small>Estás aquí</small>' : ''}</a>`).join('') + '</div>';
    root.append(btn, menu); document.body.appendChild(root); place();
    const close = () => { root.classList.remove('o'); btn.setAttribute('aria-expanded', 'false'); };
    const open = () => {
      const r = root.getBoundingClientRect(); menu.style.left = r.left > innerWidth / 2 ? 'auto' : '0'; menu.style.right = r.left > innerWidth / 2 ? '0' : 'auto';
      menu.style.top = r.top > innerHeight / 2 ? 'auto' : '70px'; menu.style.bottom = r.top > innerHeight / 2 ? '70px' : 'auto';
      root.classList.add('o'); btn.setAttribute('aria-expanded', 'true');
    };
    let drag = null, moved = false;
    btn.addEventListener('pointerdown', e => { drag = { dx: e.clientX - root.offsetLeft, dy: e.clientY - root.offsetTop }; moved = false; try { btn.setPointerCapture(e.pointerId); } catch (_) { } });
    btn.addEventListener('pointermove', e => { if (!drag) return; const nx = e.clientX - drag.dx, ny = e.clientY - drag.dy; if (Math.abs(nx - root.offsetLeft) + Math.abs(ny - root.offsetTop) > 4) moved = true; if (moved) { pos.x = nx; pos.y = ny; place(); close(); } });
    btn.addEventListener('pointerup', () => { if (!drag) return; drag = null; if (moved) { const p = place(); pos.x = p.x; pos.y = p.y; ls.set('gs.lz.pos', JSON.stringify(pos)); } else (root.classList.contains('o') ? close() : open()); });
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); root.classList.contains('o') ? close() : open(); } });
    document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    menu.addEventListener('click', e => { if (e.target.closest('a')) setTimeout(close, 50); if (e.target.hasAttribute('data-hide')) { ss.set('1'); root.remove(); } });
    window.addEventListener('resize', place);
  }
  /* «Ocultar» solo lo oculta hasta que se cierre la ventana; al abrir la app de nuevo vuelve a aparecer. */
  window.GS_LANZADOR = { mostrar() { ss.set('0'); build(); }, ocultar() { ss.set('1'); const r = document.getElementById('gsLz'); if (r) r.remove(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true }); else build();
})();
