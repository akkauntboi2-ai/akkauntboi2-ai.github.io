/* ====== НАСТРОЙКИ ДАННЫХ ====== */
/** Читаем локальные CSV-файлы из папки с сайтом:
 *   1) catalog_eva.csv  — основной (мы его уже почистили)
 *   2) catalog_eva_ready.csv / catalog_eva_fixed.csv — запасные
 */
const CSV_PATHS = ['catalog_eva.csv','catalog_eva_ready.csv','catalog_eva_fixed.csv'];

/** Телеграм администратора (замените на свои данные) */
const TELEGRAM_USERNAME = '@lmoxinur';
const TELEGRAM_URL = 'https://t.me/lmoxinur';

/* ====== Элементы ====== */
let qvEl, qvImg, qvTitle, qvDesc, qvPrice, qvBuy, toTopBtn;
let metaInfo;
let productsGrid, toastEl, chipBar, searchInput, tgHeaderBtn;

/* ====== Состояние ====== */
let allProducts = [];
let currentCategory = 'all';
let searchQuery = '';

/* ====== Утилиты ====== */
const $$ = (sel, root=document) => root.querySelector(sel);
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatPrice(n){
  const v = Number(String(n||'').replace(/[^\d.-]/g,''))||0;
  return v ? (v.toLocaleString('ru-RU') + ' сум') : '—';
}
function showToast(msg, ms=1600){ if(!toastEl) return; toastEl.textContent=msg; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'), ms); }
function parseGviz(text){
  const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?/);
  if(!m) throw new Error('GViz parse failed'); return JSON.parse(m[1]);
}
function sanitizeUrl(url){
  if(!url){
    return 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><rect width=%22200%22 height=%22200%22 fill=%22%23ffe6f2%22/></svg>';
  }
  try{
    const u = new URL(url, location.origin);
    return /^https?:/i.test(u.protocol) ? u.href : url;
  }catch(e){
    return url;
  }
}

/* ==== Visual effects helpers ==== */
function highlight(text, query){
  if(!query) return escapeHtml(text||'');
  const esc = escapeHtml(text||'');
  const q = query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return esc.replace(new RegExp('(' + q + ')','ig'), '<mark class="hl">$1</mark>');
}
function attachRipples(root=document){
  root.addEventListener('click', (e)=>{
    const btn = e.target.closest('.btn');
    if(!btn) return;
    const r = document.createElement('span');
    r.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    r.style.width = r.style.height = size + 'px';
    r.style.left = (e.clientX - rect.left - size/2) + 'px';
    r.style.top  = (e.clientY - rect.top  - size/2) + 'px';
    btn.appendChild(r);
    setTimeout(()=> r.remove(), 650);
  }, {passive:true});
}
function attachTilt(card){
  if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  let rafId; const max = 8;
  function onMove(e){
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(()=>{
      card.style.setProperty('--ry', (dx*max).toFixed(2) + 'deg');
      card.style.setProperty('--rx', (-dy*max).toFixed(2) + 'deg');
    });
  }
  function reset(){ card.style.setProperty('--ry','0deg'); card.style.setProperty('--rx','0deg'); }
  card.addEventListener('mousemove', onMove);
  card.addEventListener('mouseleave', reset);
}
function makeObserver(){
  const io = new IntersectionObserver((entries)=>{
    for(const it of entries){
      if(it.isIntersecting){ it.target.classList.add('in-view'); io.unobserve(it.target); }
    }
  }, {rootMargin: '0px 0px -10% 0px', threshold: .1});
  return io;
}

/* ========= Очистка названий (чтобы не было «квадратиков») ====== */
function stripEmoji(s=""){
  return String(s).replace(/[\u{1F100}-\u{1FFFF}\u2600-\u27FF]/gu, "");
}
function sentenceCaseRu(s=""){
  let t = String(s).trim().replace(/\s+/g," ");
  t = t.replace(/ - /g, " — ").toLowerCase();
  const keep = ["SPF","UV","UVA","UVB","AHA","BHA","PHA","Niacinamide","Retinol","HA"];
  keep.forEach(k => { t = t.replace(new RegExp(`\\b${k.toLowerCase()}\\b`,"g"), k); });
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/* ====== Telegram deep-link ====== */
function buyInTelegram(product){
  const username = TELEGRAM_USERNAME.replace(/^@/, '');
  const text = encodeURIComponent(`Здравствуйте! Хочу купить: ${sentenceCaseRu(stripEmoji(product.name))} (ID: ${product.id}, UID: ${product.uid}). Цена: ${formatPrice(product.price)}.`);
  const tgApp = `tg://resolve?domain=${username}&text=${text}`;
  const tgWeb = `${TELEGRAM_URL}?text=${text}`;
  window.open(tgApp, '_self');
  setTimeout(()=> { try{ window.open(tgWeb, '_blank'); } catch(e){ location.href = tgWeb; } }, 700);
}
// ===== Quick View =====
function openQuickView(p){
  if(!qvEl) return;
  qvImg.src = sanitizeUrl(p.img);
  qvImg.alt = p.name || '';
  qvTitle.textContent = sentenceCaseRu(stripEmoji(p.name));
  qvDesc.textContent  = p.desc || '';
  qvPrice.textContent = formatPrice(p.price);
  qvBuy.onclick = () => buyInTelegram(p);
  qvEl.hidden = false; document.body.style.overflow = 'hidden';
}
function closeQuickView(){ if(!qvEl) return; qvEl.hidden = true; document.body.style.overflow = ''; }

// ===== Save/Restore state (search + category) =====
function saveState(){
  try{ localStorage.setItem('mia_state', JSON.stringify({ q: searchQuery, cat: currentCategory })); }catch(_){}
}
function restoreState(){
  try{
    const s = JSON.parse(localStorage.getItem('mia_state')||'{}');
    if(s.q){ searchQuery = s.q; if(searchInput) searchInput.value = s.q; }
    if(s.cat){ currentCategory = s.cat; }
  }catch(_){}
}

/* ====== Загрузка из CSV ====== */
async function tryLoadCsv(paths=CSV_PATHS){
  for(const p of paths){
    try{
      const r = await fetch(p, {cache:'no-store'});
      if(!r.ok) continue;
      const text = await r.text();
      const rows = parseCsvFlexible(text);
      if(!rows.length) continue;
      const { data } = mapCsvColumns(rows);
      if(!data.length) continue;
      return data;
    }catch(e){ /* next */ }
  }
  return [];
}


function uniqueize(list){
  const used = new Set();
  list.forEach((p, i) => {
    // base for uid
    let base = String(p.uid || p.id || p.name || `p-${i+1}`).toLowerCase().replace(/[^a-z0-9\u0430-\u044f\u0451_-]+/gi,'-');
    if(!base) base = `p-${i+1}`;
    let key = base, n = 1;
    while(used.has(key) || !key){ key = base + '-' + (++n); }
    used.add(key);
    p.uid = key;
    if(!p.id){ p.id = `MI-${String(i+1).padStart(3,'0')}`; }
  });
  return list;

}

/** Гибкий парсер CSV: поддерживает запятые/точки с запятой и кавычки */
function parseCsvFlexible(text){
  const clean = text.replace(/^\uFEFF/, '');              // ← снимаем BOM
  const firstLine = (clean.split(/\r?\n/)[0] || '').trim();
  const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const lines = clean.split(/\r?\n/).filter(Boolean);
  const out = [];
  let headers = null;
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    const cells = splitCsvLine(line, sep);
    if(!headers){ headers = cells; out.push(cells); }
    else{ out.push(cells); }
  }
  return out;
}
function splitCsvLine(line, sep){
  const res = []; let cur=''; let q=false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){
      if(q && line[i+1] === '"'){ cur+='"'; i++; }
      else{ q = !q; }
    } else if(ch === sep && !q){
      res.push(cur); cur='';
    } else {
      cur += ch;
    }
  }
  res.push(cur);
  return res.map(s => s.trim());
}
function mapCsvColumns(rows){
  const header = rows[0].map(s => (s||''));
  const norm = header.map(h => h.toLowerCase().replace(/\s+/g,' '));
  const idx = {
    uid: findHeader(norm, ['uid','uuid','uniq','уник','уникальный id','key']),
    id: findHeader(norm, ['id','sku','артикул','код','код товара','product id','товар id','ид']),
    name: findHeader(norm, ['name','название','товар','наименование','product','product name','наим.']),
    desc: findHeader(norm, ['desc','description','описание','описание товара','details','подробности','опис']),
    price: findHeader(norm, ['price','цена','стоимость','cost','цена, сум','price (sum)','цена сум']),
    img: findHeader(norm, ['img','image','picture','картинка','изображение','фото','photo','image url','ссылка','ссылка_на_изображение','url фото','изобр']),
    category: findHeader(norm, ['category','категория','раздел','тип','группа']),
  };
  const data = [];
  for(let i=1;i<rows.length;i++){
    const r = rows[i];
    if(!r || r.every(v => !String(v||'').trim())) continue;
    const row = {
      uid: pick(r, idx.uid) || '',
      id: pick(r, idx.id) || `p-${i}`,
      name: pick(r, idx.name) || '',
      desc: pick(r, idx.desc) || '',
      price: pick(r, idx.price) || '',
      img: pick(r, idx.img) || '',
      category: pick(r, idx.category) || '',
    };
    data.push(row);
  }
  return { data };
}
function pick(r, i){ return (i==null||i<0||i>=r.length) ? '' : r[i]; }
function findHeader(normHeaders, candidates){
  for(let i=0;i<normHeaders.length;i++){ if(candidates.includes(normHeaders[i])) return i; }
  for(let i=0;i<normHeaders.length;i++){ const h=normHeaders[i]; if(candidates.some(c => h.includes(c))) return i; }
  return null;
}

/* ====== Рендер ====== */
function renderAll(){ buildChips(); filterAndRender(); }
function buildChips(){
  if(!chipBar) return;
  const cats = new Set(['Все']);
  allProducts.forEach(p => { const c = (p.category||'').trim(); if(c) cats.add(c); });
  chipBar.innerHTML = '';
  [...cats].forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (currentCategory.toLowerCase() === cat.toLowerCase() || (cat==='Все' && currentCategory==='all') ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      currentCategory = (cat==='Все') ? 'all' : cat;
      [...chipBar.children].forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filterAndRender();
    });
    chipBar.appendChild(chip);
  });
}
function filterAndRender(){
  const q = searchQuery.trim().toLowerCase();
  let list = allProducts.slice();
  if(currentCategory !== 'all'){
    list = list.filter(p => (p.category||'').trim().toLowerCase() === currentCategory.toLowerCase());
  }
  if(q){
    list = list.filter(p =>
      sentenceCaseRu(stripEmoji(p.name||'')).toLowerCase().includes(q) ||
      (p.desc||'').toLowerCase().includes(q)
    );
  }
  renderProducts(list);
}
function renderProducts(list){
  if(metaInfo){ metaInfo.textContent = `Товаров: ${list.length}`; }
  if(!productsGrid) return;
  productsGrid.innerHTML = '';

  if(!list.length){
    productsGrid.innerHTML = '<div class="empty">Пока пусто. Попробуйте изменить фильтр или <a href="'+TELEGRAM_URL+'" target="_blank" rel="noopener">написать нам в Telegram</a>.</div>';
    return;
  }

  list.forEach(p => {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.uid = p.uid || '';

    const img = document.createElement('img');
    img.className = 'card-img';
    img.alt = p.name || '';
    img.loading = 'lazy';
    img.src = sanitizeUrl(p.img);
    img.onerror = () => { img.removeAttribute('src'); };
    img.addEventListener('load', ()=> img.classList.add('loaded'));

    const safeName = sentenceCaseRu(stripEmoji(p.name));
    const titleHtml = highlight(safeName, searchQuery);
    const descHtml = highlight(p.desc||'', searchQuery);


    const info = document.createElement('div');
    info.className = 'card-info';
    info.innerHTML = `
      <h3 class="card-title">${titleHtml}</h3>
      <p class="card-desc">${descHtml}</p>
      <div class="card-bottom">
        <div class="price">${formatPrice(p.price)}</div>
        <button class="btn btn-tg" type="button" aria-label="Купить в Telegram">
          <svg width="18" height="18" viewBox="0 0 240 240" aria-hidden="true"><path d="M120 0a120 120 0 1 0 0 240 120 120 0 0 0 0-240Zm56 78-18 85c-1 6-5 8-10 5l-28-21-14 13c-2 2-4 4-8 4l3-32 60-54c3-3-1-4-5-2l-74 47-32-10c-7-2-7-7 2-10l126-49c6-2 12 1 10 10Z" fill="currentColor"/></svg>
          <span>Купить</span>
        </button>
      </div>
    `;

    const btn = info.querySelector('.btn-tg');
    btn.addEventListener('click', (e) => { e.stopPropagation(); buyInTelegram(p); });

    card.append(img, info);
    productsGrid.appendChild(card);
    if(window.__cardsObserver){ window.__cardsObserver.observe(card); }  // reveal on scroll
    attachTilt(card);                                                    // микро-наклон на hover
    card.addEventListener('click', ()=> openQuickView(p));               // быстрый просмотр
  });
}

/* ====== Инициализация ====== */
window.addEventListener('DOMContentLoaded', async () => {
  productsGrid = $$('#productsGrid');
  metaInfo = $$('#metaInfo');
  showSkeletons(8);
  toastEl = $$('#toast');
  chipBar = $$('#chipBar');
  searchInput = $$('#searchInput');
  tgHeaderBtn = $$('#tgHeaderBtn');

attachRipples(document);
window.__cardsObserver = makeObserver();

// NEW: получить элементы модалки и кнопку "наверх"
  qvEl     = document.getElementById('quickView');
  qvImg    = document.getElementById('qvImg');
  qvTitle  = document.getElementById('qvTitle');
  qvDesc   = document.getElementById('qvDesc');
  qvPrice  = document.getElementById('qvPrice');
  qvBuy    = document.getElementById('qvBuy');
  toTopBtn = document.getElementById('toTop');

  // NEW: закрытие модалки
  qvEl?.addEventListener('click', (e)=>{ if(e.target.dataset.close!==undefined || e.target.classList.contains('modal__backdrop')) closeQuickView(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeQuickView(); });

  // NEW: поведение кнопки "наверх"
  window.addEventListener('scroll', ()=>{ toTopBtn?.classList.toggle('show', (scrollY>300)); }, {passive:true});
  toTopBtn?.addEventListener('click', ()=> window.scrollTo({top:0, behavior:'smooth'}));
  // header TG button
  if (tgHeaderBtn){
    tgHeaderBtn.href = TELEGRAM_URL;
    tgHeaderBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      const username = TELEGRAM_USERNAME.replace(/^@/, '');
      const tgApp = `tg://resolve?domain=${username}`;
      const tgWeb = TELEGRAM_URL;
      window.open(tgApp, '_self');
      setTimeout(()=> { try{ window.open(tgWeb, '_blank'); } catch(e){ location.href = tgWeb; } }, 700);
    });
  }

  // поиск
  searchInput?.addEventListener('input', (e)=>{
    searchQuery = e.target.value || '';
    filterAndRender();
    saveState(); 
  });

  restoreState();
  // год в футере
  const y = new Date().getFullYear();
  const yEl = document.getElementById('year');
  if (yEl) yEl.textContent = y;

  // грузим CSV
  allProducts = await tryLoadCsv(CSV_PATHS);
  allProducts = uniqueize(allProducts);
  if(!allProducts.length){
    allProducts = [
      { id:'MI-001', name:'Гель для умывания', desc:'Мягко очищает кожу', price: 35000, img:'img/prod.jpg', category:'Уход' },
    ];
  }
  clearSkeletons(); renderAll();
});


/* ====== Skeleton helpers ====== */
function showSkeletons(n=8){
  if(!productsGrid) return;
  productsGrid.innerHTML = '';
  for(let i=0;i<n;i++){
    const s = document.createElement('div');
    s.className = 'skel';
    s.innerHTML = '<div class="s-img"></div><div class="s-t1"></div><div class="s-t2"></div>';
    productsGrid.appendChild(s);
  }
}
function clearSkeletons(){
  if(!productsGrid) return;
  productsGrid.querySelectorAll('.skel').forEach(el => el.remove());
}

// header shadow on scroll
window.addEventListener('scroll', () => {
  const h = document.querySelector('.site-header');
  if(!h) return;
  const y = window.scrollY || document.documentElement.scrollTop;
  h.classList.toggle('scrolled', y > 4);
}, {passive:true});
