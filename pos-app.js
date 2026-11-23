import { supabase, generateItemVisual, fmtMoney, fmtWeight } from './config.js';
import { withBusy, getBusyState, showToast, openDialog, uiAlert, uiConfirm, uiPrompt } from './ui.js';
import { initBackoffice } from './backoffice.js';

export function getTodayStr() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function buildEffectiveTimestamp(dateStr) {
  const today = getTodayStr();
  if (!dateStr || dateStr === today) return new Date().toISOString();
  const nowTime = new Date().toTimeString().slice(0, 8);
  return new Date(`${dateStr}T${nowTime}+07:00`).toISOString();
}

export const state = {
  currentUser: null,
  currentShift: null,
  categories: [],
  items: [],
  cart: [],
  heldBills: JSON.parse(localStorage.getItem('panadda_held_bills') || '[]'),
  activeTab: 'pos'
};

let pinBuffer = '';
let posCurrentPage = 0;
let posTotalPages = 1;
let resizeTimer = null;
let wheelLock = false;
let npState = { editIndex: null, item: null, selectedVariant: null, target: 'weight', weight: '', tare: '0', price: '0', firstTouchPrice: true };

function resetPosDateToToday() {
  const dInput = document.getElementById('pos-tx-date');
  if (dInput) {
    dInput.value = getTodayStr();
    window.checkPosBackdateBadge();
  }
}

window.checkPosBackdateBadge = () => {
  const val = document.getElementById('pos-tx-date')?.value;
  const isBack = val && val !== getTodayStr();
  document.getElementById('pos-backdate-badge')?.classList.toggle('hidden', !isBack);
};

window.pressPin = (digit) => {
  if (getBusyState() || pinBuffer.length >= 6) return;
  pinBuffer += digit;
  document.getElementById('pin-dots').textContent = '●'.repeat(pinBuffer.length);
  document.getElementById('pin-error').textContent = '';
};

window.clearPin = () => {
  pinBuffer = '';
  document.getElementById('pin-dots').textContent = '••••';
};

window.submitPin = () => {
  if (!pinBuffer) return;
  withBusy('กำลังเข้าสู่ระบบ...', async () => {
    const { data, error } = await supabase.rpc('verify_pin', { p_pin: pinBuffer });
    if (error || !data?.success) {
      document.getElementById('pin-error').textContent = data?.message || 'รหัส PIN ไม่ถูกต้อง';
      window.clearPin();
      return;
    }

    state.currentUser = data.user;
    sessionStorage.setItem('panadda_active_user', JSON.stringify(state.currentUser));
    window.clearPin();
    document.getElementById('pin-screen').classList.add('hidden');
    resetPosDateToToday();
    await loadInitialData();
    window.switchTab('pos');
    showToast(`เข้าสู่ระบบ: ${state.currentUser.full_name}`, 'success');
  });
};

window.logoutPin = () => {
  state.currentUser = null;
  sessionStorage.removeItem('panadda_active_user');
  window.clearPin();
  document.getElementById('pin-screen').classList.remove('hidden');
};

export function applyRolePermissions() {
  if (!state.currentUser) return;
  const role = state.currentUser.role;
  document.getElementById('user-display').textContent = `${state.currentUser.full_name} (${role.toUpperCase()})`;
  document.getElementById('nav-drawer').classList.toggle('hidden', role === 'staff');
  document.getElementById('nav-sell').classList.toggle('hidden', role === 'staff');
  document.getElementById('nav-owner').classList.toggle('hidden', role !== 'owner');
  document.getElementById('btn-quick-add-item').classList.toggle('hidden', role !== 'owner');
  document.getElementById('drawer-badge').classList.toggle('hidden', role === 'staff');
}

export async function loadInitialData() {
  const [catRes, itemRes, shiftRes, transitRes] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('items').select('*, categories(name, color_hex)').eq('is_active', true).order('usage_count', { ascending: false }),
    supabase.from('cash_shifts').select('*').eq('status', 'OPEN').order('opened_at', { ascending: false }).limit(1),
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('tx_type', 'SELL').eq('status', 'IN_TRANSIT')
  ]);

  state.categories = catRes.data || [];
  state.items = itemRes.data || [];
  state.currentShift = shiftRes.data?.[0] || null;

  const tCount = transitRes.count || 0;
  const tBadge = document.getElementById('transit-badge');
  if (tBadge) {
    tBadge.textContent = tCount;
    tBadge.classList.toggle('hidden', tCount === 0);
  }

  applyRolePermissions();
  updateTopDrawerBalance();
  window.renderItemGrid();
  updateHoldBadge();
}

async function updateTopDrawerBalance() {
  const el = document.getElementById('top-drawer-amt');
  if (!el) return;
  if (!state.currentShift || !state.currentUser) {
    el.textContent = 'ยังไม่เปิดกะ';
    return;
  }
  const { data } = await supabase.rpc('get_wallet_balances_pin', { p_user_id: state.currentUser.id, p_shift_id: state.currentShift.id });
  if (data) el.textContent = `${fmtMoney(data.drawer)} ฿`;
}

window.switchTab = (tab) => {
  if (state.currentUser?.role === 'staff' && tab !== 'pos') return;
  if (state.currentUser?.role !== 'owner' && tab === 'owner') return;

  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('bg-emerald-600', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('bg-slate-800', !active);
    b.classList.toggle('text-slate-300', !active);
  });

  ['pos', 'drawer', 'sell', 'owner'].forEach(v => {
    document.getElementById(`view-${v}`)?.classList.toggle('hidden', v !== tab);
  });

  applyRolePermissions();
  if (tab === 'pos') setTimeout(() => window.renderItemGrid(), 30);
  if (tab === 'drawer') withBusy('กำลังโหลดข้อมูลบิล...', window.loadDrawerView);
  if (tab === 'sell') withBusy('กำลังโหลดข้อมูลส่งขาย...', window.loadSellView);
  if (tab === 'owner') withBusy('กำลังโหลดข้อมูลสรุปร้าน...', window.loadOwnerView);
};

window.toggleMobileCart = (open) => {
  document.getElementById('pos-cart-panel')?.classList.toggle('mobile-open', open);
};

function getPosGridMetrics(carouselEl) {
  const w = window.innerWidth;
  let cols = 4;
  let cardHeight = 124;

  if (w < 768) {
    cols = 2;
    cardHeight = 108;
  } else if (w < 1200) {
    cols = 3;
    cardHeight = 120;
  } else if (w < 1536) {
    cols = 4;
    cardHeight = 124;
  } else {
    cols = 5;
    cardHeight = 124;
  }

  const gap = 10;
  const fallbackH = Math.max(240, window.innerHeight - (w < 768 ? 250 : 175));
  const availH = (carouselEl && carouselEl.clientHeight > 120) ? carouselEl.clientHeight : fallbackH;
  const rows = Math.max(2, Math.floor((availH + gap) / (cardHeight + gap)));

  return { cols, rows, perPage: cols * rows, cardHeight };
}

window.onSearchPosItems = () => {
  posCurrentPage = 0;
  window.renderItemGrid();
};

window.renderItemGrid = () => {
  const q = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
  const carousel = document.getElementById('items-carousel');
  if (!carousel) return;

  const { cols, perPage, cardHeight } = getPosGridMetrics(carousel);

  const filtered = state.items.filter(it =>
    !q || it.name.toLowerCase().includes(q) || (it.short_code && it.short_code.toLowerCase().includes(q))
  );

  const cardElements = filtered.map(it => {
    const color = it.categories?.color_hex || '#475569';
    const vis = generateItemVisual(it.name, color, it.short_code);
    const variants = Array.isArray(it.sub_variants) ? it.sub_variants : [];
    const subTags = variants.length ? `<div class="text-[10px] text-slate-400 truncate mt-0.5">${variants.map(v => v.name).join(' • ')}</div>` : '';
    const displayPrice = variants.length ? `${fmtMoney(variants[0].price)} ฿` : `${fmtMoney(it.default_buy_price)} ฿`;

    return `
      <button onclick="openItemNumpad('${it.id}')" 
        style="border-color: ${vis.color}66; height: ${cardHeight}px;"
        class="item-card active-press bg-slate-800/90 hover:bg-slate-800 border-2 rounded-2xl p-2.5 flex flex-col justify-between text-left shadow-md relative overflow-hidden">
        <div class="flex justify-between items-start w-full z-10">
          <span style="background:${vis.color}33; color:${vis.color}" class="px-2 py-0.5 rounded-md text-[11px] font-extrabold leading-tight">${vis.badge}</span>
          <span class="bg-slate-950/90 text-emerald-400 font-extrabold px-2 py-0.5 rounded-lg text-xs border border-slate-700 leading-tight">${displayPrice}</span>
        </div>
        <div style="color: ${vis.color}" class="my-auto mx-auto opacity-90">${vis.iconSvg}</div>
        <div class="z-10 w-full">
          <div class="font-bold text-xs sm:text-sm text-white leading-tight truncate">${it.name}</div>
          ${subTags}
        </div>
      </button>
    `;
  });

  if (state.currentUser?.role === 'owner' && !q) {
    cardElements.push(`
      <button onclick="openItemEditor()" style="height: ${cardHeight}px;"
        class="item-card active-press bg-slate-900/60 hover:bg-slate-800/80 border-2 border-dashed border-amber-500/50 rounded-2xl p-2.5 flex flex-col items-center justify-center text-amber-400 gap-1">
        <span class="text-2xl font-bold leading-none">＋</span>
        <span class="font-bold text-xs">เพิ่มสินค้าประจำร้าน</span>
      </button>
    `);
  }

  if (!cardElements.length) {
    posTotalPages = 1;
    posCurrentPage = 0;
    carousel.innerHTML = `<div class="w-full h-full flex items-center justify-center text-slate-500 text-sm">ไม่พบสินค้าที่ค้นหา</div>`;
    renderPosPagerControls();
    return;
  }

  const pages = [];
  for (let i = 0; i < cardElements.length; i += perPage) {
    pages.push(cardElements.slice(i, i + perPage));
  }

  posTotalPages = pages.length;
  if (posCurrentPage >= posTotalPages) posCurrentPage = posTotalPages - 1;

  carousel.innerHTML = pages.map(chunk => `
    <div class="w-full min-w-full h-full shrink-0 snap-start snap-always grid gap-2.5 content-start pr-0.5"
         style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">
      ${chunk.join('')}
    </div>
  `).join('');

  requestAnimationFrame(() => {
    carousel.scrollTo({ left: posCurrentPage * carousel.clientWidth, behavior: 'instant' });
    renderPosPagerControls();
  });
};

window.goToPosPage = (idx) => {
  const carousel = document.getElementById('items-carousel');
  if (!carousel) return;
  posCurrentPage = Math.max(0, Math.min(posTotalPages - 1, idx));
  carousel.scrollTo({ left: posCurrentPage * carousel.clientWidth, behavior: 'smooth' });
  renderPosPagerControls();
};

window.stepPosPage = (delta) => {
  window.goToPosPage(posCurrentPage + delta);
};

window.syncPosPageIndicator = () => {
  const carousel = document.getElementById('items-carousel');
  if (!carousel || !carousel.clientWidth) return;
  const idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
  if (idx !== posCurrentPage) {
    posCurrentPage = Math.max(0, Math.min(posTotalPages - 1, idx));
    renderPosPagerControls();
  }
};

function renderPosPagerControls() {
  const dotsEl = document.getElementById('pos-page-dots');
  const prevBtn = document.getElementById('btn-pos-prev');
  const nextBtn = document.getElementById('btn-pos-next');
  if (!dotsEl) return;

  if (prevBtn) prevBtn.disabled = posCurrentPage <= 0;
  if (nextBtn) nextBtn.disabled = posTotalPages <= 1 || posCurrentPage >= posTotalPages - 1;

  dotsEl.innerHTML = Array.from({ length: posTotalPages }, (_, i) => {
    const active = i === posCurrentPage;
    return `
      <button onclick="goToPosPage(${i})"
        class="h-7 min-w-[1.75rem] px-2 rounded-lg text-xs font-extrabold transition ${active ? 'bg-emerald-600 text-white shadow' : 'bg-slate-800/80 text-slate-400 hover:text-white'}">
        ${i + 1}
      </button>
    `;
  }).join('');
}

function attachPosCarouselGestures() {
  const carousel = document.getElementById('items-carousel');
  if (!carousel) return;

  carousel.addEventListener('wheel', (e) => {
    if (posTotalPages <= 1) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      if (wheelLock) return;
      wheelLock = true;
      window.stepPosPage(e.deltaY > 0 ? 1 : -1);
      setTimeout(() => { wheelLock = false; }, 260);
    }
  }, { passive: false });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.activeTab === 'pos') window.renderItemGrid();
    }, 150);
  });
}

window.openItemNumpad = (itemId, editIdx = null) => {
  const posDateVal = document.getElementById('pos-tx-date')?.value;
  const isToday = !posDateVal || posDateVal === getTodayStr();
  document.getElementById('np-auto-save-price').checked = isToday;

  if (editIdx !== null) {
    const row = state.cart[editIdx];
    const baseItem = state.items.find(i => i.id === row.item_id) || { id: '', name: row.base_name || row.name, max_buy_price: null, default_buy_price: row.unit_price, sub_variants: [] };
    npState = {
      editIndex: editIdx,
      item: baseItem,
      selectedVariant: row.variant_name || null,
      target: 'weight',
      weight: String(row.weight_kg),
      tare: String(row.tare_kg),
      price: String(row.unit_price),
      firstTouchPrice: true
    };
  } else {
    const it = state.items.find(i => i.id === itemId);
    if (!it) return;
    const variants = Array.isArray(it.sub_variants) ? it.sub_variants : [];
    const firstVar = variants.length > 0 ? variants[0] : null;

    npState = {
      editIndex: null,
      item: it,
      selectedVariant: firstVar ? firstVar.name : null,
      target: 'weight',
      weight: '',
      tare: '0',
      price: String(firstVar ? firstVar.price : it.default_buy_price),
      firstTouchPrice: true
    };
  }

  document.getElementById('np-item-name').textContent = npState.item.name;
  document.getElementById('np-max-hint').textContent = npState.item.max_buy_price ? `(เพดาน ${npState.item.max_buy_price})` : '';
  document.getElementById('btn-quick-variant').classList.toggle('hidden', !npState.item.id);
  renderNumpadVariants();
  window.setNpTarget('weight');
  refreshNpDisplay();
  document.getElementById('numpad-modal').classList.remove('hidden');
};

function renderNumpadVariants() {
  const bar = document.getElementById('np-variants-bar');
  const variants = Array.isArray(npState.item?.sub_variants) ? npState.item.sub_variants : [];

  if (!variants.length) {
    bar.innerHTML = `<span class="text-xs text-slate-500">ไม่มีเกรดย่อย (แตะ "+ เพิ่มเกรดย่อย" ด้านขวาได้ทันที)</span>`;
    return;
  }

  bar.innerHTML = variants.map((v, i) => {
    const active = npState.selectedVariant === v.name;
    return `
      <button onclick="selectNpVariant(${i})" 
        class="active-press px-3.5 py-2 rounded-xl text-xs font-bold border transition ${active ? 'bg-amber-500 text-slate-950 border-amber-400 shadow' : 'bg-slate-800 text-slate-200 border-slate-700'}">
        ${v.name} (${fmtMoney(v.price)})
      </button>
    `;
  }).join('');
}

window.selectNpVariant = (idx) => {
  const variants = npState.item.sub_variants || [];
  const picked = variants[idx];
  if (!picked) return;
  npState.selectedVariant = picked.name;
  npState.price = String(picked.price);
  npState.firstTouchPrice = true;
  renderNumpadVariants();
  refreshNpDisplay();
};

window.quickAddVariantFromNumpad = async () => {
  if (!npState.item?.id) return;
  const res = await openDialog({
    title: `เพิ่มเกรดย่อยของ "${npState.item.name}"`,
    type: 'info',
    fields: [
      { label: 'ชื่อเกรดย่อย / สภาพของ', placeholder: 'เช่น ปอกสวย, เผา, ช็อต, สาย' },
      { label: 'ราคาตั้งต้น (บาท/กก.)', type: 'number', defaultValue: npState.price }
    ],
    confirmText: 'บันทึกเกรดย่อย',
    cancelText: 'ยกเลิก'
  });
  if (!res) return;

  const [vName, rawPrice] = res;
  const vPrice = parseFloat(rawPrice || 0);
  if (!vName.trim() || vPrice <= 0) return showToast('กรุณาระบุชื่อเกรดย่อยและราคาให้ถูกต้อง', 'warning');

  await withBusy('กำลังบันทึกเกรดย่อย...', async () => {
    const currentVars = Array.isArray(npState.item.sub_variants) ? [...npState.item.sub_variants] : [];
    currentVars.push({ name: vName.trim(), price: vPrice });

    const { error } = await supabase.from('items').update({ sub_variants: currentVars }).eq('id', npState.item.id);
    if (error) return uiAlert('บันทึกไม่สำเร็จ', error.message, 'error');

    npState.item.sub_variants = currentVars;
    npState.selectedVariant = vName.trim();
    npState.price = String(vPrice);
    renderNumpadVariants();
    refreshNpDisplay();
    window.renderItemGrid();
    showToast(`เพิ่มเกรด "${vName.trim()}" เรียบร้อย`, 'success');
  });
};

window.closeNumpad = () => document.getElementById('numpad-modal').classList.add('hidden');

window.setNpTarget = (target) => {
  npState.target = target;
  ['weight', 'tare', 'price'].forEach(t => {
    const box = document.getElementById(`box-np-${t}`);
    box.className = `cursor-pointer rounded-2xl p-2 sm:p-2.5 border-2 bg-slate-950 ${t === target ? 'border-emerald-500' : 'border-slate-800'}`;
  });
};

window.quickTare = (kg) => { npState.tare = String(kg); refreshNpDisplay(); };

window.npPress = (ch) => {
  let cur = npState[npState.target];
  if (npState.target === 'price' && npState.firstTouchPrice) { cur = ''; npState.firstTouchPrice = false; }
  if (ch === '.' && cur.includes('.')) return;
  if (cur === '0' && ch !== '.') cur = '';
  npState[npState.target] = cur + ch;
  refreshNpDisplay();
};

window.npBackspace = () => {
  let cur = npState[npState.target];
  npState[npState.target] = cur.slice(0, -1) || '0';
  refreshNpDisplay();
};

function refreshNpDisplay() {
  const w = parseFloat(npState.weight || 0);
  const t = parseFloat(npState.tare || 0);
  const p = parseFloat(npState.price || 0);
  const net = Math.max(0, w - t);
  const sub = Math.round(net * p * 100) / 100;

  document.getElementById('val-np-weight').textContent = npState.weight || '0';
  document.getElementById('val-np-tare').textContent = npState.tare || '0';
  document.getElementById('val-np-price').textContent = npState.price || '0';
  document.getElementById('np-preview-sub').textContent = fmtMoney(sub);
}

window.confirmNumpadItem = () => {
  const w = parseFloat(npState.weight || 0);
  const t = parseFloat(npState.tare || 0);
  const p = parseFloat(npState.price || 0);
  const net = Math.round((w - t) * 100) / 100;

  if (net <= 0) return showToast('กรุณาใส่น้ำหนักสุทธิให้มากกว่า 0 กก.', 'warning');

  const maxP = npState.item.max_buy_price;
  if (maxP && p > maxP && state.currentUser.role !== 'owner') {
    return uiAlert('ราคาเกินเพดานที่กำหนด!', `สูงสุดไม่เกิน ${maxP} บาท/กก.\nหากต้องการให้ราคาพิเศษต้องใช้สิทธิ์เจ้าของร้าน`, 'warning');
  }

  const posDateVal = document.getElementById('pos-tx-date')?.value;
  const isToday = !posDateVal || posDateVal === getTodayStr();
  const autoSavePrice = document.getElementById('np-auto-save-price').checked && isToday;
  const vName = npState.selectedVariant;
  const fullName = vName ? `${npState.item.name} (${vName})` : npState.item.name;

  let refDefaultPrice = Number(npState.item.default_buy_price);
  if (vName && Array.isArray(npState.item.sub_variants)) {
    const foundV = npState.item.sub_variants.find(v => v.name === vName);
    if (foundV) refDefaultPrice = Number(foundV.price);
  }

  const entry = {
    item_id: npState.item.id || '',
    base_name: npState.item.name,
    variant_name: vName || null,
    name: fullName,
    custom_name: npState.item.id ? null : fullName,
    custom_cat_id: npState.item.custom_cat_id || null,
    weight_kg: w,
    tare_kg: t,
    net_weight_kg: net,
    unit_price: p,
    is_override: p !== refDefaultPrice,
    auto_update_price: autoSavePrice,
    subtotal: Math.round(net * p * 100) / 100
  };

  if (autoSavePrice && npState.item.id) {
    if (vName && Array.isArray(npState.item.sub_variants)) {
      const targetV = npState.item.sub_variants.find(v => v.name === vName);
      if (targetV) targetV.price = p;
    } else {
      npState.item.default_buy_price = p;
    }
    window.renderItemGrid();
  }

  if (npState.editIndex !== null) state.cart[npState.editIndex] = entry;
  else state.cart.push(entry);

  window.closeNumpad();
  renderCart();
};

window.openCustomItemModal = async () => {
  const name = await uiPrompt('เพิ่มรายการขาจร / ตีราคาเหมา', 'พิมพ์ชื่อของเก่า เช่น มอเตอร์เก่า, ซากแอร์');
  if (!name || !name.trim()) return;
  npState = {
    editIndex: null,
    item: { id: '', name: name.trim(), default_buy_price: 0, max_buy_price: null, sub_variants: [], custom_cat_id: state.categories[state.categories.length - 1]?.id },
    selectedVariant: null,
    target: 'weight', weight: '1', tare: '0', price: '', firstTouchPrice: false
  };
  document.getElementById('np-item-name').textContent = name.trim() + ' (คีย์สด)';
  document.getElementById('np-max-hint').textContent = '';
  document.getElementById('btn-quick-variant').classList.add('hidden');
  document.getElementById('np-variants-bar').innerHTML = '';
  window.setNpTarget('price');
  refreshNpDisplay();
  document.getElementById('numpad-modal').classList.remove('hidden');
};

export function renderCart() {
  const list = document.getElementById('cart-list');
  if (!list) return;

  if (!state.cart.length) {
    list.innerHTML = `<div class="text-center text-slate-500 py-16">แตะรูปสินค้าเพื่อเริ่มชั่งกิโล</div>`;
  } else {
    list.innerHTML = state.cart.map((c, idx) => `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-2">
        <div onclick="openItemNumpad('${c.item_id}', ${idx})" class="flex-1 cursor-pointer min-w-0">
          <div class="font-bold text-white flex items-center gap-1.5 truncate">
            <span class="truncate">${idx + 1}. ${c.name}</span>
            ${c.is_override ? '<span class="text-[10px] bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded shrink-0">ราคาใหม่</span>' : ''}
          </div>
          <div class="text-xs text-slate-400">
            ${fmtWeight(c.net_weight_kg)} กก. ${c.tare_kg > 0 ? `(หักเข่ง ${c.tare_kg})` : ''} × ${fmtMoney(c.unit_price)} ฿
          </div>
        </div>
        <div class="text-right font-extrabold text-lg text-emerald-400 shrink-0">${fmtMoney(c.subtotal)}</div>
        <button onclick="removeCartItem(${idx})" class="text-red-400 hover:bg-red-950 px-2.5 py-2 rounded-xl text-sm shrink-0">🗑️</button>
      </div>
    `).join('');
  }

  const totalKg = state.cart.reduce((s, i) => s + i.net_weight_kg, 0);
  const totalAmt = state.cart.reduce((s, i) => s + i.subtotal, 0);

  document.getElementById('cart-total-kg').textContent = fmtWeight(totalKg);
  document.getElementById('cart-item-count').textContent = state.cart.length;
  document.getElementById('cart-total-amt').textContent = fmtMoney(totalAmt);

  const mKg = document.getElementById('m-cart-kg');
  if (mKg) {
    mKg.textContent = fmtWeight(totalKg);
    document.getElementById('m-cart-count').textContent = state.cart.length;
    document.getElementById('m-cart-amt').textContent = fmtMoney(totalAmt);
  }
}

window.removeCartItem = (idx) => { state.cart.splice(idx, 1); renderCart(); };

window.clearCart = async () => {
  if (!state.cart.length) return;
  const ok = await uiConfirm('ล้างรายการชั่งทั้งหมด?', 'รายการในตะกร้าปัจจุบันจะถูกลบออกทั้งหมด', 'warning', 'ล้างตะกร้า');
  if (ok) {
    state.cart = [];
    renderCart();
    showToast('ล้างตะกร้าเรียบร้อย', 'info');
  }
};

window.holdCurrentBill = async () => {
  if (state.cart.length > 0) {
    const label = await uiPrompt('พักบิลชั่วคราว', 'ระบุชื่อลูกค้า / สีรถ', `คิวพัก #${state.heldBills.length + 1}`);
    if (!label) return;
    state.heldBills.push({ label, cart: state.cart });
    state.cart = [];
    localStorage.setItem('panadda_held_bills', JSON.stringify(state.heldBills));
    renderCart();
    updateHoldBadge();
    showToast(`พักบิล "${label}" ไว้แล้ว`, 'info');
  } else if (state.heldBills.length > 0) {
    const pick = state.heldBills.pop();
    state.cart = pick.cart;
    localStorage.setItem('panadda_held_bills', JSON.stringify(state.heldBills));
    renderCart();
    updateHoldBadge();
    showToast(`ดึงบิล "${pick.label}" กลับมาชั่งต่อแล้ว`, 'success');
  } else {
    showToast('ยังไม่มีรายการให้พัก หรือบิลที่พักค้างไว้', 'warning');
  }
};

function updateHoldBadge() {
  const el = document.getElementById('hold-count');
  if (el) el.textContent = state.heldBills.length;
}

window.openCheckoutModal = () => {
  if (!state.cart.length) return showToast('ยังไม่มีรายการในตะกร้า', 'warning');
  const total = Math.round(state.cart.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  document.getElementById('co-total').textContent = `${fmtMoney(total)} ฿`;
  document.getElementById('co-tx-date').value = document.getElementById('pos-tx-date')?.value || getTodayStr();
  document.getElementById('pay-drawer').value = total;
  document.getElementById('pay-safe').value = 0;
  document.getElementById('pay-bank').value = 0;
  document.getElementById('co-customer').value = '';
  document.getElementById('checkout-modal').classList.remove('hidden');
};

window.closeCheckoutModal = () => document.getElementById('checkout-modal').classList.add('hidden');

window.syncSplitPay = (changed) => {
  const total = Math.round(state.cart.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  if (changed === 'safe') {
    const safeAmt = parseFloat(document.getElementById('pay-safe').value || 0);
    document.getElementById('pay-drawer').value = Math.max(0, Math.round((total - safeAmt) * 100) / 100);
  }
};

window.submitBuyTransaction = () => {
  const total = Math.round(state.cart.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  const dAmt = parseFloat(document.getElementById('pay-drawer').value || 0);
  const sAmt = parseFloat(document.getElementById('pay-safe').value || 0);
  const bAmt = parseFloat(document.getElementById('pay-bank').value || 0);
  const chosenDate = document.getElementById('co-tx-date').value || getTodayStr();
  const isToday = chosenDate === getTodayStr();

  if (dAmt > 0 && isToday && !state.currentShift) {
    return uiAlert('ยังไม่ได้เปิดกะลิ้นชักวันนี้', 'กรุณาเปิดกะลิ้นชักในแท็บ "ลิ้นชัก & ประวัติบิล" ก่อนตัดเงินสดวันนี้ (หรือเปลี่ยนวันที่บิลเป็นวันย้อนหลัง)', 'warning');
  }
  if (Math.abs((dAmt + sAmt + bAmt) - total) > 0.05) {
    return uiAlert('ยอดเงินไม่ตรงกับยอดสุทธิ', `รวมช่องทางจ่าย: ${fmtMoney(dAmt + sAmt + bAmt)} ฿\nยอดสุทธิบิล: ${fmtMoney(total)} ฿`, 'warning');
  }

  const payments = [];
  if (dAmt > 0) payments.push({ wallet: 'DRAWER', amount: dAmt });
  if (sAmt > 0) payments.push({ wallet: 'SAFE', amount: sAmt });
  if (bAmt > 0) payments.push({ wallet: 'BANK', amount: bAmt });

  withBusy('กำลังบันทึกบิล...', async () => {
    const { data, error } = await supabase.rpc('create_buy_transaction_pin', {
      p_user_id: state.currentUser.id,
      p_shift_id: state.currentShift?.id || null,
      p_customer_name: document.getElementById('co-customer').value.trim() || null,
      p_note: null,
      p_items: state.cart,
      p_payments: payments,
      p_tx_date: buildEffectiveTimestamp(chosenDate)
    });

    if (error) return uiAlert('บันทึกบิลไม่สำเร็จ', error.message, 'error');

    document.getElementById('pos-tx-date').value = chosenDate;
    window.checkPosBackdateBadge();
    window.closeCheckoutModal();
    window.toggleMobileCart(false);
    state.cart = [];
    renderCart();
    await loadInitialData();
    showToast(`บันทึกบิล ${data.bill_no} สำเร็จ (${fmtMoney(data.total_amount)} ฿)`, 'success');
  });
};

resetPosDateToToday();
attachPosCarouselGestures();
initBackoffice({ state, loadInitialData, renderCart });

(async function restoreSession() {
  const saved = sessionStorage.getItem('panadda_active_user');
  if (!saved) return;
  try {
    state.currentUser = JSON.parse(saved);
    document.getElementById('pin-screen').classList.add('hidden');
    resetPosDateToToday();
    await withBusy('กำลังโหลดข้อมูลร้าน...', async () => {
      await loadInitialData();
      window.switchTab('pos');
    });
  } catch (e) {
    sessionStorage.removeItem('panadda_active_user');
  }
})();