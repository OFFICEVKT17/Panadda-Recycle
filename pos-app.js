import { supabase, generateItemVisual, fmtMoney, fmtWeight } from './config.js';

let currentUser = null;
let currentShift = null;
let categories = [];
let items = [];
let cart = [];
let heldBills = JSON.parse(localStorage.getItem('panadda_held_bills') || '[]');
let activeTab = 'pos';
let catChartInstance = null;
let flowChartInstance = null;

let pinBuffer = '';
let npState = { editIndex: null, item: null, selectedVariant: null, target: 'weight', weight: '', tare: '0', price: '0', firstTouchPrice: true };

const DIALOG_THEMES = {
  success: { icon: '✓', bg: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30', btn: 'bg-emerald-600 hover:bg-emerald-500' },
  warning: { icon: '!', bg: 'bg-amber-500/20 text-amber-400 border border-amber-500/30', btn: 'bg-amber-600 hover:bg-amber-500' },
  error:   { icon: '✕', bg: 'bg-red-500/20 text-red-400 border border-red-500/30', btn: 'bg-red-600 hover:bg-red-500' },
  info:    { icon: '✎', bg: 'bg-sky-500/20 text-sky-400 border border-sky-500/30', btn: 'bg-sky-600 hover:bg-sky-500' }
};

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const styles = {
    success: 'bg-slate-900/95 border-emerald-500/60 text-emerald-300',
    warning: 'bg-slate-900/95 border-amber-500/60 text-amber-300',
    error:   'bg-slate-900/95 border-red-500/60 text-red-300',
    info:    'bg-slate-900/95 border-sky-500/60 text-sky-300'
  };
  const badgeIcons = { success: '✅', warning: '⚠️', error: '⛔', info: 'ℹ️' };

  const el = document.createElement('div');
  el.className = `anim-toast pointer-events-auto border-2 rounded-2xl px-4 py-3.5 shadow-2xl flex items-center gap-3 backdrop-blur-md ${styles[type] || styles.success}`;
  el.innerHTML = `
    <span class="text-lg shrink-0">${badgeIcons[type] || '✅'}</span>
    <span class="text-sm font-semibold text-white leading-snug flex-1">${message}</span>
  `;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.2s ease';
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

function openDialog({ title, message = '', type = 'info', fields = [], confirmText = 'ตกลง', cancelText = null }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('ui-dialog-overlay');
    const iconEl = document.getElementById('ui-dialog-icon');
    const titleEl = document.getElementById('ui-dialog-title');
    const msgEl = document.getElementById('ui-dialog-msg');
    const inputsEl = document.getElementById('ui-dialog-inputs');
    const actionsEl = document.getElementById('ui-dialog-actions');

    const theme = DIALOG_THEMES[type] || DIALOG_THEMES.info;
    iconEl.className = `w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-extrabold shrink-0 ${theme.bg}`;
    iconEl.textContent = theme.icon;
    titleEl.textContent = title;
    msgEl.textContent = message;
    msgEl.classList.toggle('hidden', !message);

    if (fields.length > 0) {
      inputsEl.classList.remove('hidden');
      inputsEl.innerHTML = fields.map((f, idx) => `
        <div>
          ${f.label ? `<label class="block text-xs text-slate-400 mb-1">${f.label}</label>` : ''}
          <input id="dlg-field-${idx}" type="${f.type || 'text'}" step="${f.step || 'any'}" value="${f.defaultValue ?? ''}" placeholder="${f.placeholder || ''}"
            class="w-full bg-slate-800 border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-xl px-4 py-3 text-white font-semibold text-base" />
        </div>
      `).join('');
    } else {
      inputsEl.classList.add('hidden');
      inputsEl.innerHTML = '';
    }

    actionsEl.innerHTML = '';
    const close = (result) => {
      overlay.classList.add('hidden');
      resolve(result);
    };

    if (cancelText) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'active-press bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-5 py-3 rounded-2xl text-sm';
      cancelBtn.textContent = cancelText;
      cancelBtn.onclick = () => close(null);
      actionsEl.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.className = `active-press ${theme.btn} text-white font-bold px-6 py-3 rounded-2xl text-sm shadow-lg`;
    okBtn.textContent = confirmText;
    okBtn.onclick = () => {
      if (!fields.length) return close(true);
      const values = fields.map((_, idx) => document.getElementById(`dlg-field-${idx}`).value);
      close(fields.length === 1 ? values[0] : values);
    };
    actionsEl.appendChild(okBtn);

    overlay.classList.remove('hidden');
    if (fields.length > 0) {
      setTimeout(() => {
        const first = document.getElementById('dlg-field-0');
        first?.focus();
        first?.select();
      }, 40);
    }
  });
}

const uiAlert = (title, message = '', type = 'info') => openDialog({ title, message, type, confirmText: 'รับทราบ' });
const uiConfirm = (title, message = '', type = 'warning', confirmText = 'ยืนยัน') => openDialog({ title, message, type, confirmText, cancelText: 'ยกเลิก' });
const uiPrompt = (title, placeholder = '', defaultValue = '', inputType = 'text') => openDialog({
  title,
  type: 'info',
  fields: [{ placeholder, defaultValue, type: inputType }],
  confirmText: 'ตกลง',
  cancelText: 'ยกเลิก'
});

function parseVariantsText(txt) {
  if (!txt || !txt.trim()) return [];
  return txt.split(',').map(part => {
    const [n, p] = part.split(':').map(s => s.trim());
    return n ? { name: n, price: parseFloat(p || 0) } : null;
  }).filter(Boolean);
}

function formatVariantsText(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.map(v => `${v.name}:${v.price}`).join(', ');
}

window.pressPin = (digit) => {
  if (pinBuffer.length >= 6) return;
  pinBuffer += digit;
  document.getElementById('pin-dots').textContent = '●'.repeat(pinBuffer.length);
  document.getElementById('pin-error').textContent = '';
};

window.clearPin = () => {
  pinBuffer = '';
  document.getElementById('pin-dots').textContent = '••••';
};

window.submitPin = async () => {
  if (!pinBuffer) return;
  const { data, error } = await supabase.rpc('verify_pin', { p_pin: pinBuffer });
  if (error || !data?.success) {
    document.getElementById('pin-error').textContent = data?.message || 'รหัสไม่ถูกต้อง';
    window.clearPin();
    return;
  }

  currentUser = data.user;
  window.clearPin();
  document.getElementById('pin-screen').classList.add('hidden');
  showToast(`เข้าสู่ระบบ: ${currentUser.full_name}`, 'success');
  await loadInitialData();
  window.switchTab('pos');
};

window.logoutPin = () => {
  currentUser = null;
  document.getElementById('pin-screen').classList.remove('hidden');
};

function applyRolePermissions() {
  if (!currentUser) return;
  const role = currentUser.role;
  document.getElementById('user-display').textContent = `${currentUser.full_name} (${role.toUpperCase()})`;
  document.getElementById('nav-drawer').classList.toggle('hidden', role === 'staff');
  document.getElementById('nav-sell').classList.toggle('hidden', role === 'staff');
  document.getElementById('nav-owner').classList.toggle('hidden', role !== 'owner');
  document.getElementById('btn-quick-add-item').classList.toggle('hidden', role !== 'owner');
  document.getElementById('drawer-badge').classList.toggle('hidden', role === 'staff');
}

async function loadInitialData() {
  const [catRes, itemRes, shiftRes, transitRes] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('items').select('*, categories(name, color_hex)').eq('is_active', true).order('usage_count', { ascending: false }),
    supabase.from('cash_shifts').select('*').eq('status', 'OPEN').order('opened_at', { ascending: false }).limit(1),
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('tx_type', 'SELL').eq('status', 'IN_TRANSIT')
  ]);

  categories = catRes.data || [];
  items = itemRes.data || [];
  currentShift = shiftRes.data?.[0] || null;

  const tCount = transitRes.count || 0;
  const tBadge = document.getElementById('transit-badge');
  tBadge.textContent = tCount;
  tBadge.classList.toggle('hidden', tCount === 0);

  applyRolePermissions();
  updateTopDrawerBalance();
  renderItemGrid();
  updateHoldBadge();
}

async function updateTopDrawerBalance() {
  const el = document.getElementById('top-drawer-amt');
  if (!currentShift || !currentUser) {
    el.textContent = 'ยังไม่เปิดกะ';
    return;
  }
  const { data } = await supabase.rpc('get_wallet_balances_pin', { p_user_id: currentUser.id, p_shift_id: currentShift.id });
  if (data) el.textContent = `${fmtMoney(data.drawer)} ฿`;
}

window.switchTab = (tab) => {
  if (currentUser?.role === 'staff' && tab !== 'pos') return;
  if (currentUser?.role !== 'owner' && tab === 'owner') return;

  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('bg-emerald-600', active);
    b.classList.toggle('text-white', active);
    b.classList.toggle('bg-slate-800', !active);
    b.classList.toggle('text-slate-300', !active);
  });

  ['pos', 'drawer', 'sell', 'owner'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('hidden', v !== tab);
  });

  applyRolePermissions();
  if (tab === 'drawer') loadDrawerView();
  if (tab === 'sell') loadSellView();
  if (tab === 'owner') loadOwnerView();
};

window.renderItemGrid = () => {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const grid = document.getElementById('items-grid');

  const filtered = items.filter(it =>
    !q || it.name.toLowerCase().includes(q) || (it.short_code && it.short_code.toLowerCase().includes(q))
  );

  grid.innerHTML = filtered.map(it => {
    const color = it.categories?.color_hex || '#475569';
    const vis = generateItemVisual(it.name, color, it.short_code);
    const variants = Array.isArray(it.sub_variants) ? it.sub_variants : [];
    const subTags = variants.length ? `<div class="text-[11px] text-slate-400 truncate mt-0.5">${variants.map(v => v.name).join(' • ')}</div>` : '';
    const displayPrice = variants.length ? `${fmtMoney(variants[0].price)} ฿` : `${fmtMoney(it.default_buy_price)} ฿`;

    return `
      <button onclick="openItemNumpad('${it.id}')" 
        style="border-color: ${vis.color}66;"
        class="active-press bg-slate-800/90 hover:bg-slate-800 border-2 rounded-3xl p-3 flex flex-col justify-between text-left shadow-md h-44 relative overflow-hidden">
        <div class="flex justify-between items-start w-full z-10">
          <span style="background:${vis.color}33; color:${vis.color}" class="px-2.5 py-0.5 rounded-lg text-xs font-extrabold">${vis.badge}</span>
          <span class="bg-slate-950/90 text-emerald-400 font-extrabold px-2.5 py-1 rounded-xl text-sm border border-slate-700">${displayPrice}</span>
        </div>
        <div style="color: ${vis.color}" class="my-auto mx-auto opacity-90">${vis.iconSvg}</div>
        <div class="z-10 w-full">
          <div class="font-bold text-base text-white leading-tight truncate">${it.name}</div>
          ${subTags}
        </div>
      </button>
    `;
  }).join('');
};

window.openItemNumpad = (itemId, editIdx = null) => {
  document.getElementById('np-auto-save-price').checked = true;

  if (editIdx !== null) {
    const row = cart[editIdx];
    const baseItem = items.find(i => i.id === row.item_id) || { id: '', name: row.base_name || row.name, max_buy_price: null, default_buy_price: row.unit_price, sub_variants: [] };
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
    const it = items.find(i => i.id === itemId);
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
  setNpTarget('weight');
  refreshNpDisplay();
  document.getElementById('numpad-modal').classList.remove('hidden');
};

function renderNumpadVariants() {
  const bar = document.getElementById('np-variants-bar');
  const variants = Array.isArray(npState.item?.sub_variants) ? npState.item.sub_variants : [];

  if (!variants.length) {
    bar.innerHTML = `<span class="text-xs text-slate-500">ไม่มีรายการย่อย (กด "+ เพิ่มเกรดย่อย" ด้านขวาเพื่อเพิ่ม)</span>`;
    return;
  }

  bar.innerHTML = variants.map((v, i) => {
    const active = npState.selectedVariant === v.name;
    return `
      <button onclick="selectNpVariant(${i})" 
        class="px-3 py-1.5 rounded-xl text-xs font-bold border transition ${active ? 'bg-amber-500 text-slate-950 border-amber-400 shadow' : 'bg-slate-800 text-slate-200 border-slate-700'}">
        ${v.name} (${fmtMoney(v.price)}฿)
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

  const currentVars = Array.isArray(npState.item.sub_variants) ? [...npState.item.sub_variants] : [];
  currentVars.push({ name: vName.trim(), price: vPrice });

  const { error } = await supabase.from('items').update({ sub_variants: currentVars }).eq('id', npState.item.id);
  if (error) return uiAlert('บันทึกไม่สำเร็จ', error.message, 'error');

  npState.item.sub_variants = currentVars;
  npState.selectedVariant = vName.trim();
  npState.price = String(vPrice);
  renderNumpadVariants();
  refreshNpDisplay();
  renderItemGrid();
  showToast(`เพิ่มเกรด "${vName.trim()}" เรียบร้อย`, 'success');
};

window.closeNumpad = () => document.getElementById('numpad-modal').classList.add('hidden');

window.setNpTarget = (target) => {
  npState.target = target;
  ['weight', 'tare', 'price'].forEach(t => {
    const box = document.getElementById(`box-np-${t}`);
    box.className = `cursor-pointer rounded-2xl p-2.5 border-2 bg-slate-950 ${t === target ? 'border-emerald-500' : 'border-slate-800'}`;
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
  if (maxP && p > maxP && currentUser.role !== 'owner') {
    return uiAlert('ราคาเกินเพดานที่กำหนด!', `สูงสุดไม่เกิน ${maxP} บาท/กก.\nหากต้องการให้ราคาพิเศษต้องใช้สิทธิ์เจ้าของร้าน`, 'warning');
  }

  const autoSavePrice = document.getElementById('np-auto-save-price').checked;
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
    renderItemGrid();
  }

  if (npState.editIndex !== null) cart[npState.editIndex] = entry;
  else cart.push(entry);

  closeNumpad();
  renderCart();
};

window.openCustomItemModal = async () => {
  const name = await uiPrompt('เพิ่มรายการอื่นๆ / ตีราคาเหมา', 'พิมพ์ชื่อของเก่า เช่น มอเตอร์เก่า, ซากแอร์');
  if (!name || !name.trim()) return;
  npState = {
    editIndex: null,
    item: { id: '', name: name.trim(), default_buy_price: 0, max_buy_price: null, sub_variants: [], custom_cat_id: categories[categories.length - 1]?.id },
    selectedVariant: null,
    target: 'weight', weight: '1', tare: '0', price: '', firstTouchPrice: false
  };
  document.getElementById('np-item-name').textContent = name.trim() + ' (คีย์สด)';
  document.getElementById('np-max-hint').textContent = '';
  document.getElementById('btn-quick-variant').classList.add('hidden');
  document.getElementById('np-variants-bar').innerHTML = '';
  setNpTarget('price');
  refreshNpDisplay();
  document.getElementById('numpad-modal').classList.remove('hidden');
};

function renderCart() {
  const list = document.getElementById('cart-list');
  if (!cart.length) {
    list.innerHTML = `<div class="text-center text-slate-500 py-16">แตะรูปสินค้าฝั่งซ้ายเพื่อเริ่มชั่งกิโล</div>`;
  } else {
    list.innerHTML = cart.map((c, idx) => `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-2">
        <div onclick="openItemNumpad('${c.item_id}', ${idx})" class="flex-1 cursor-pointer">
          <div class="font-bold text-white flex items-center gap-1.5">
            <span>${idx + 1}. ${c.name}</span>
            ${c.is_override ? '<span class="text-[10px] bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded">ราคาใหม่</span>' : ''}
          </div>
          <div class="text-xs text-slate-400">
            ${fmtWeight(c.net_weight_kg)} กก. ${c.tare_kg > 0 ? `(หักเข่ง ${c.tare_kg})` : ''} × ${fmtMoney(c.unit_price)} ฿
          </div>
        </div>
        <div class="text-right font-extrabold text-lg text-emerald-400">${fmtMoney(c.subtotal)}</div>
        <button onclick="removeCartItem(${idx})" class="text-red-400 hover:bg-red-950 px-2.5 py-2 rounded-xl text-sm">🗑️</button>
      </div>
    `).join('');
  }

  document.getElementById('cart-total-kg').textContent = fmtWeight(cart.reduce((s, i) => s + i.net_weight_kg, 0));
  document.getElementById('cart-item-count').textContent = cart.length;
  document.getElementById('cart-total-amt').textContent = fmtMoney(cart.reduce((s, i) => s + i.subtotal, 0));
}

window.removeCartItem = (idx) => { cart.splice(idx, 1); renderCart(); };

window.clearCart = async () => {
  if (!cart.length) return;
  const ok = await uiConfirm('ล้างรายการชั่งทั้งหมด?', 'รายการในตะกร้าปัจจุบันจะถูกลบออกทั้งหมด', 'warning', 'ล้างตะกร้า');
  if (ok) {
    cart = [];
    renderCart();
    showToast('ล้างตะกร้าเรียบร้อย', 'info');
  }
};

window.holdCurrentBill = async () => {
  if (cart.length > 0) {
    const label = await uiPrompt('พักบิลชั่วคราว', 'ระบุชื่อลูกค้า / สีรถ', `คิวพัก #${heldBills.length + 1}`);
    if (!label) return;
    heldBills.push({ label, cart });
    cart = [];
    localStorage.setItem('panadda_held_bills', JSON.stringify(heldBills));
    renderCart();
    updateHoldBadge();
    showToast(`พักบิล "${label}" ไว้แล้ว`, 'info');
  } else if (heldBills.length > 0) {
    const pick = heldBills.pop();
    cart = pick.cart;
    localStorage.setItem('panadda_held_bills', JSON.stringify(heldBills));
    renderCart();
    updateHoldBadge();
    showToast(`ดึงบิล "${pick.label}" กลับมาชั่งต่อแล้ว`, 'success');
  } else {
    showToast('ยังไม่มีรายการให้พัก หรือบิลที่พักค้างไว้', 'warning');
  }
};

function updateHoldBadge() { document.getElementById('hold-count').textContent = heldBills.length; }

window.openCheckoutModal = () => {
  if (!cart.length) return showToast('ยังไม่มีรายการในตะกร้า', 'warning');
  const total = Math.round(cart.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  document.getElementById('co-total').textContent = `${fmtMoney(total)} ฿`;
  document.getElementById('pay-drawer').value = total;
  document.getElementById('pay-safe').value = 0;
  document.getElementById('pay-bank').value = 0;
  document.getElementById('co-customer').value = '';
  document.getElementById('checkout-modal').classList.remove('hidden');
};

window.closeCheckoutModal = () => document.getElementById('checkout-modal').classList.add('hidden');

window.syncSplitPay = (changed) => {
  const total = Math.round(cart.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  if (changed === 'safe') {
    const safeAmt = parseFloat(document.getElementById('pay-safe').value || 0);
    document.getElementById('pay-drawer').value = Math.max(0, Math.round((total - safeAmt) * 100) / 100);
  }
};

window.submitBuyTransaction = async () => {
  const total = Math.round(cart.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  const dAmt = parseFloat(document.getElementById('pay-drawer').value || 0);
  const sAmt = parseFloat(document.getElementById('pay-safe').value || 0);
  const bAmt = parseFloat(document.getElementById('pay-bank').value || 0);

  if (dAmt > 0 && !currentShift) {
    return uiAlert('ยังไม่ได้เปิดกะลิ้นชัก', 'กรุณาเปิดกะลิ้นชักในแท็บ "ลิ้นชัก & บิลวันนี้" ก่อนตัดเงินสดจากลิ้นชัก', 'warning');
  }
  if (Math.abs((dAmt + sAmt + bAmt) - total) > 0.05) {
    return uiAlert('ยอดเงินไม่ตรงกับยอดสุทธิ', `รวมช่องทางจ่าย: ${fmtMoney(dAmt + sAmt + bAmt)} ฿\nยอดสุทธิบิล: ${fmtMoney(total)} ฿`, 'warning');
  }

  const payments = [];
  if (dAmt > 0) payments.push({ wallet: 'DRAWER', amount: dAmt });
  if (sAmt > 0) payments.push({ wallet: 'SAFE', amount: sAmt });
  if (bAmt > 0) payments.push({ wallet: 'BANK', amount: bAmt });

  const btn = document.getElementById('btn-confirm-pay');
  btn.disabled = true;

  const { data, error } = await supabase.rpc('create_buy_transaction_pin', {
    p_user_id: currentUser.id,
    p_shift_id: currentShift?.id || null,
    p_customer_name: document.getElementById('co-customer').value.trim() || null,
    p_note: null,
    p_items: cart,
    p_payments: payments
  });

  btn.disabled = false;
  if (error) return uiAlert('บันทึกบิลไม่สำเร็จ', error.message, 'error');

  closeCheckoutModal();
  cart = [];
  renderCart();
  await loadInitialData();
  showToast(`บันทึกบิล ${data.bill_no} สำเร็จ (${fmtMoney(data.total_amount)} ฿)`, 'success');
};

window.loadDrawerView = async () => {
  await loadInitialData();
  const panel = document.getElementById('shift-panel-content');

  if (!currentShift) {
    panel.innerHTML = `
      <p class="text-sm text-amber-400 mb-3">สถานะ: ยังไม่ได้เปิดกะลิ้นชัก</p>
      <input id="open-shift-amt" type="number" placeholder="นับเงินตั้งต้นในลิ้นชัก (บาท)" class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-bold mb-3" />
      <button onclick="openNewShift()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl">🔓 เปิดกะรับซื้อวันนี้</button>
    `;
  } else {
    panel.innerHTML = `
      <div class="text-xs text-slate-400 mb-2">เปิดกะเมื่อ: ${new Date(currentShift.opened_at).toLocaleString('th-TH')} (ตั้งต้น ${fmtMoney(currentShift.opening_cash)} ฿)</div>
      <p class="text-xs text-amber-300 mb-2">ปิดกะแบบ Blind Close: นับเงินสดจริงในลิ้นชักแล้วกรอกด้านล่าง</p>
      <input id="close-shift-amt" type="number" placeholder="ยอดเงินสดที่นับได้จริง (บาท)" class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-bold mb-2" />
      <button onclick="closeCurrentShift()" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl">🔒 ยืนยันปิดกะเย็น</button>
    `;
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: bills } = await supabase
    .from('transactions')
    .select('*, transaction_items(net_weight_kg, unit_price, subtotal, variant_name, custom_item_name, items(name))')
    .eq('tx_type', 'BUY')
    .gte('created_at', startOfDay.toISOString())
    .order('created_at', { ascending: false });

  const bList = document.getElementById('today-bills-list');
  if (!bills?.length) {
    bList.innerHTML = `<div class="text-slate-500 text-sm py-6 text-center">ยังไม่มีบิลรับซื้อในวันนี้</div>`;
    return;
  }

  bList.innerHTML = bills.map(b => {
    const isVoid = b.status === 'VOIDED';
    const summary = (b.transaction_items || []).map(ti => {
      const label = ti.items?.name ? (ti.variant_name ? `${ti.items.name}-${ti.variant_name}` : ti.items.name) : ti.custom_item_name;
      return `${label} (${ti.net_weight_kg} กก.)`;
    }).join(', ');
    return `
      <div class="bg-slate-900 border ${isVoid ? 'border-red-900/60 opacity-60' : 'border-slate-800'} rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-bold text-white flex items-center gap-2">
            <span>${b.bill_no}</span>
            <span class="text-xs text-slate-400">${new Date(b.created_at).toLocaleTimeString('th-TH')}</span>
            ${isVoid ? `<span class="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded">ยกเลิกแล้ว: ${b.void_reason}</span>` : ''}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">${summary}</div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-lg font-extrabold ${isVoid ? 'line-through text-slate-500' : 'text-emerald-400'}">${fmtMoney(b.total_amount)} ฿</span>
          ${!isVoid ? `
            <button onclick='editBillToPos(${JSON.stringify(b.id)})' class="bg-amber-600/20 text-amber-300 px-3 py-1.5 rounded-xl text-xs font-bold">แก้ไขบิล</button>
            <button onclick="voidBill('${b.id}', '${b.bill_no}')" class="bg-red-600/20 text-red-400 px-3 py-1.5 rounded-xl text-xs font-bold">ยกเลิก</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
};

window.openNewShift = async () => {
  const amt = parseFloat(document.getElementById('open-shift-amt').value || 0);
  const { error } = await supabase.from('cash_shifts').insert({ opened_by: currentUser.id, opening_cash: amt, status: 'OPEN' });
  if (error) return uiAlert('เปิดกะไม่สำเร็จ', error.message, 'error');
  showToast(`เปิดกะลิ้นชักเริ่มต้น ${fmtMoney(amt)} ฿ เรียบร้อย`, 'success');
  await loadDrawerView();
};

window.closeCurrentShift = async () => {
  const actual = parseFloat(document.getElementById('close-shift-amt').value);
  if (isNaN(actual)) return showToast('กรุณากรอกยอดเงินสดที่นับได้จริง', 'warning');

  const ok = await uiConfirm('ยืนยันปิดกะลิ้นชักวันนี้?', `ยอดเงินสดที่นับจริง: ${fmtMoney(actual)} บาท`, 'warning', 'ปิดกะทันที');
  if (!ok) return;

  const { data, error } = await supabase.rpc('close_cash_shift_pin', {
    p_user_id: currentUser.id,
    p_shift_id: currentShift.id,
    p_actual_cash: actual,
    p_note: null
  });
  if (error) return uiAlert('ปิดกะไม่สำเร็จ', error.message, 'error');

  const diffMsg = data.diff === 0 ? 'ยอดเงินตรงเป๊ะ!' : (data.diff > 0 ? `เงินเกิน +${fmtMoney(data.diff)} บาท` : `เงินขาด ${fmtMoney(data.diff)} บาท`);
  await uiAlert('สรุปผลปิดกะลิ้นชัก', `ยอดตามระบบ: ${fmtMoney(data.expected)} ฿\nนับเงินสดจริง: ${fmtMoney(data.actual)} ฿\nผลลัพธ์: ${diffMsg}`, data.diff === 0 ? 'success' : 'warning');
  await loadDrawerView();
};

window.saveDrawerMovement = async () => {
  if (!currentShift) return uiAlert('ยังไม่ได้เปิดกะ', 'ต้องเปิดกะลิ้นชักก่อนทำรายการเติมหรือเบิกเงิน', 'warning');
  const cat = document.getElementById('mv-type').value;
  const amt = parseFloat(document.getElementById('mv-amount').value || 0);
  const note = document.getElementById('mv-note').value.trim();
  if (amt <= 0 || !note) return showToast('กรุณาระบุจำนวนเงินและหมายเหตุให้ครบ', 'warning');

  const { error } = await supabase.from('wallet_movements').insert({
    shift_id: currentShift.id,
    wallet: 'DRAWER',
    direction: cat === 'CASH_IN' ? 'IN' : 'OUT',
    category: cat,
    amount: amt,
    note,
    created_by: currentUser.id
  });
  if (error) return uiAlert('บันทึกไม่สำเร็จ', error.message, 'error');
  document.getElementById('mv-amount').value = '';
  document.getElementById('mv-note').value = '';
  await loadDrawerView();
  showToast('บันทึกรายการลิ้นชักเรียบร้อย', 'success');
};

window.voidBill = async (txId, billNo) => {
  const reason = await uiPrompt(`ยกเลิกบิล ${billNo}`, 'ระบุสาเหตุ เช่น คีย์น้ำหนักผิด / ลูกค้ายกเลิก');
  if (!reason || !reason.trim()) return;
  const { error } = await supabase.rpc('void_transaction_pin', { p_user_id: currentUser.id, p_tx_id: txId, p_reason: reason.trim() });
  if (error) return uiAlert('ยกเลิกบิลไม่ได้', error.message, 'error');
  await loadDrawerView();
  showToast(`ยกเลิกบิล ${billNo} และคืนยอดเงินแล้ว`, 'success');
};

window.editBillToPos = async (txId) => {
  const reason = await uiPrompt('แก้ไขบิล (ดึงกลับไปหน้าชั่ง)', 'ระบุสาเหตุที่แก้ไข เช่น แก้น้ำหนักเข่ง');
  if (!reason || !reason.trim()) return;
  const { error } = await supabase.rpc('void_transaction_pin', { p_user_id: currentUser.id, p_tx_id: txId, p_reason: `แก้ไขบิล: ${reason.trim()}` });
  if (error) return uiAlert('ไม่สามารถดึงบิลแก้ไขได้', error.message, 'error');

  const { data: fullItems } = await supabase.from('transaction_items').select('*, items(name, default_buy_price)').eq('tx_id', txId);
  cart = (fullItems || []).map(fi => {
    const baseName = fi.items?.name || fi.custom_item_name;
    const fullName = fi.variant_name ? `${baseName} (${fi.variant_name})` : baseName;
    return {
      item_id: fi.item_id || '',
      base_name: baseName,
      variant_name: fi.variant_name || null,
      name: fullName,
      custom_name: fi.custom_item_name,
      custom_cat_id: fi.custom_category_id,
      weight_kg: Number(fi.weight_kg),
      tare_kg: Number(fi.tare_kg),
      net_weight_kg: Number(fi.net_weight_kg),
      unit_price: Number(fi.unit_price),
      is_override: fi.is_price_overridden,
      auto_update_price: true,
      subtotal: Number(fi.subtotal)
    };
  });
  renderCart();
  window.switchTab('pos');
  showToast('ดึงรายการกลับมาแก้ไขที่หน้า POS แล้ว', 'info');
};

window.togglePartialWeight = () => {
  const full = document.getElementById('ship-clear-all').checked;
  document.getElementById('ship-partial-kg').classList.toggle('hidden', full);
};

window.loadSellView = async () => {
  await loadInitialData();
  const mainSel = document.getElementById('ship-main-item');
  mainSel.innerHTML = items.map(i => `<option value="${i.id}">${i.name} (ในลาน: ${fmtWeight(i.current_stock_kg)} กก.)</option>`).join('');
  renderBundleCheckboxes();

  const { data: sells } = await supabase
    .from('transactions')
    .select('*, transaction_items(*, items(name), sell_bundled_piles(*, items(name)))')
    .eq('tx_type', 'SELL')
    .order('created_at', { ascending: false })
    .limit(20);

  const transit = (sells || []).filter(s => s.status === 'IN_TRANSIT');
  const done = (sells || []).filter(s => s.status === 'COMPLETED');

  document.getElementById('in-transit-list').innerHTML = transit.length ? transit.map(t => {
    const ti = t.transaction_items?.[0];
    const bundles = (ti?.sell_bundled_piles || []).map(b => `${b.items?.name} (${b.cleared_weight_kg} กก.)`).join(', ');
    return `
      <div class="bg-slate-900 border border-amber-500/40 rounded-2xl p-4 space-y-3">
        <div class="flex justify-between">
          <div>
            <div class="font-bold text-white">${t.bill_no} — ${t.customer_or_factory_name || 'ไม่ระบุโรงงาน'}</div>
            <div class="text-xs text-slate-400">สินค้าหลัก: ${ti?.items?.name} (ตัดสต็อก ${fmtWeight(ti?.stock_before_sell_kg)} กก.) ${bundles ? `| พ่วงกอง: ${bundles}` : ''}</div>
            <div class="text-xs text-amber-300">ต้นทุนรวมของรอบนี้: ${fmtMoney(t.total_cost_snapshot)} ฿</div>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input id="settle-w-${t.id}" type="number" step="0.01" placeholder="น้ำหนักใบชั่งโรงงาน (กก.)" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold" />
          <input id="settle-p-${t.id}" type="number" step="0.01" placeholder="ราคาขายที่ได้ (บาท/กก.)" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-bold" />
          <select id="settle-wal-${t.id}" class="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white">
            <option value="BANK">รับเงินโอนเข้าธนาคาร</option>
            <option value="SAFE">รับเงินสดเข้าตู้เซฟ</option>
            <option value="DRAWER">รับเงินสดเข้าลิ้นชัก</option>
          </select>
        </div>
        <button onclick="settleShipment('${t.id}')" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-sm">✅ ยืนยันใบชั่ง & ปิดยอดคิดกำไร</button>
      </div>
    `;
  }).join('') : `<div class="text-slate-500 text-sm text-center py-4">ไม่มีเที่ยวรถที่รอใบชั่ง</div>`;

  document.getElementById('completed-sell-list').innerHTML = done.length ? done.map(d => {
    const ti = d.transaction_items?.[0];
    const yieldKg = ti?.sell_bundled_piles?.[0]?.estimated_yield_kg;
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex justify-between items-center text-sm">
        <div>
          <div class="font-bold">${d.bill_no} (${d.customer_or_factory_name || '-'}) — ${ti?.items?.name}</div>
          <div class="text-xs text-slate-400">ขายจริง ${fmtWeight(d.total_weight_kg)} กก. × ${fmtMoney(ti?.unit_price)} ฿ ${yieldKg > 0 ? `| เนื้อที่ได้จากกองพ่วง: ${fmtWeight(yieldKg)} กก.` : ''}</div>
        </div>
        <div class="text-right">
          <div class="font-bold text-emerald-400">รับ ${fmtMoney(d.total_amount)} ฿</div>
          <div class="text-xs ${d.realized_profit >= 0 ? 'text-sky-400' : 'text-red-400'}">กำไรสุทธิ: ${fmtMoney(d.realized_profit)} ฿</div>
        </div>
      </div>
    `;
  }).join('') : `<div class="text-slate-500 text-sm text-center py-4">ยังไม่มีประวัติการขาย</div>`;
};

window.renderBundleCheckboxes = () => {
  const mainId = document.getElementById('ship-main-item').value;
  const box = document.getElementById('ship-bundle-list');
  box.innerHTML = items.filter(i => i.id !== mainId && i.current_stock_kg > 0).map(i => `
    <label class="flex items-center justify-between text-xs bg-slate-950 px-3 py-2 rounded-lg cursor-pointer">
      <span><input type="checkbox" value="${i.id}" class="bundle-chk accent-amber-500 mr-2" />${i.name}</span>
      <span class="text-slate-400">${fmtWeight(i.current_stock_kg)} กก. (ทุน ${fmtMoney(i.current_total_cost)} ฿)</span>
    </label>
  `).join('') || `<div class="text-xs text-slate-500">ไม่มีกองอื่นที่มีสต็อกคงเหลือ</div>`;
};

window.createShipment = async () => {
  const factory = document.getElementById('ship-factory').value.trim();
  const mainId = document.getElementById('ship-main-item').value;
  const clearAll = document.getElementById('ship-clear-all').checked;
  const partialKg = parseFloat(document.getElementById('ship-partial-kg').value || 0);
  const bundledIds = Array.from(document.querySelectorAll('.bundle-chk:checked')).map(el => el.value);

  if (!factory) return showToast('กรุณาระบุชื่อโรงงานหรือทะเบียนรถ', 'warning');
  const { error } = await supabase.rpc('create_factory_shipment_pin', {
    p_user_id: currentUser.id,
    p_factory_name: factory,
    p_main_item_id: mainId,
    p_clear_main_pile: clearAll,
    p_partial_weight_kg: partialKg,
    p_bundled_item_ids: bundledIds
  });
  if (error) return uiAlert('บันทึกขึ้นรถไม่สำเร็จ', error.message, 'error');
  document.getElementById('ship-factory').value = '';
  await loadSellView();
  showToast('ตัดกองขึ้นรถเรียบร้อย! หน้าลานเริ่มนับกองใหม่ที่ 0 กก.', 'success');
};

window.settleShipment = async (txId) => {
  const w = parseFloat(document.getElementById(`settle-w-${txId}`).value || 0);
  const p = parseFloat(document.getElementById(`settle-p-${txId}`).value || 0);
  const wal = document.getElementById(`settle-wal-${txId}`).value;
  if (w <= 0 || p <= 0) return showToast('กรุณากรอกน้ำหนักใบชั่งโรงงานและราคาขายให้ครบ', 'warning');

  const { data, error } = await supabase.rpc('settle_factory_shipment_pin', {
    p_user_id: currentUser.id,
    p_shift_id: currentShift?.id || null,
    p_tx_id: txId,
    p_actual_weight_kg: w,
    p_sell_unit_price: p,
    p_receive_wallet: wal
  });
  if (error) return uiAlert('ปิดยอดขายไม่สำเร็จ', error.message, 'error');
  await loadSellView();
  await uiAlert('ปิดยอดขายโรงงานสำเร็จ!', `รับเงินรวม: ${fmtMoney(data.total_amount)} ฿\nกำไรสุทธิรอบนี้: ${fmtMoney(data.profit)} ฿`, 'success');
};

window.loadOwnerView = async () => {
  await loadInitialData();
  const { data: bal } = await supabase.rpc('get_wallet_balances_pin', { p_user_id: currentUser.id, p_shift_id: currentShift?.id || null });
  if (bal) {
    document.getElementById('ow-drawer').textContent = `${fmtMoney(bal.drawer)} ฿`;
    document.getElementById('ow-safe').textContent = `${fmtMoney(bal.safe)} ฿`;
    document.getElementById('ow-bank').textContent = `${fmtMoney(bal.bank)} ฿`;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [txRes, userRes] = await Promise.all([
    supabase.from('transactions').select('*').gte('created_at', sevenDaysAgo).order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('created_at')
  ]);

  const txs = txRes.data || [];
  const voids = txs.filter(t => t.status === 'VOIDED');
  document.getElementById('ow-void-count').textContent = `${voids.length} ใบ`;

  document.getElementById('owner-void-log').innerHTML = voids.map(v => `
    <div class="bg-slate-900 border border-red-900/40 rounded-xl p-2.5 text-xs flex justify-between">
      <span><strong>${v.bill_no}</strong> (${fmtMoney(v.total_amount)} ฿) — เหตุผล: ${v.void_reason}</span>
      <span class="text-slate-400">${new Date(v.voided_at).toLocaleString('th-TH')}</span>
    </div>
  `).join('') || `<div class="text-slate-500 text-xs">ไม่มีบิลถูกยกเลิกใน 7 วันล่าสุด</div>`;

  document.getElementById('owner-stock-table').innerHTML = items.map(it => {
    const avg = it.current_stock_kg > 0 ? (it.current_total_cost / it.current_stock_kg) : 0;
    const varStr = formatVariantsText(it.sub_variants);
    return `
      <tr>
        <td class="py-2 pr-2"><input id="iname-${it.id}" type="text" value="${it.name}" class="w-40 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-semibold" /></td>
        <td class="pr-2"><input id="icode-${it.id}" type="text" maxlength="6" value="${it.short_code || ''}" class="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs" /></td>
        <td class="text-emerald-400 font-bold pr-2">${fmtWeight(it.current_stock_kg)}</td>
        <td class="text-amber-300 pr-2">${fmtMoney(avg)} ฿</td>
        <td class="pr-2"><input id="ip-${it.id}" type="number" step="0.01" value="${it.default_buy_price}" class="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></td>
        <td class="pr-2"><input id="im-${it.id}" type="number" step="0.01" value="${it.max_buy_price || ''}" placeholder="-" class="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></td>
        <td class="pr-2"><input id="ivar-${it.id}" type="text" value="${varStr}" placeholder="เช่น ปอก:265, เผา:245" class="w-56 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200" /></td>
        <td class="flex gap-1 py-2">
          <button onclick="saveItemFull('${it.id}')" class="active-press bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded-lg text-xs font-bold">บันทึก</button>
          <button onclick="hideItem('${it.id}', '${it.name}')" class="active-press bg-red-900/40 hover:bg-red-900/70 text-red-300 px-2 py-1.5 rounded-lg text-xs">ซ่อน</button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('owner-users-list').innerHTML = (userRes.data || []).map(u => `
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex justify-between items-center text-xs">
      <span><strong>${u.full_name}</strong> (${u.role.toUpperCase()}) — PIN: <code class="text-emerald-400 font-bold">${u.pin_code}</code></span>
      <button onclick="toggleUserActive('${u.id}', ${!u.is_active})" class="px-2.5 py-1 rounded-lg font-bold ${u.is_active ? 'bg-red-900/40 text-red-300' : 'bg-emerald-900/40 text-emerald-300'}">${u.is_active ? 'ระงับสิทธิ์' : 'เปิดใช้'}</button>
    </div>
  `).join('');

  renderOwnerCharts(txs);
};

window.saveItemFull = async (id) => {
  const name = document.getElementById(`iname-${id}`).value.trim();
  const short_code = document.getElementById(`icode-${id}`).value.trim() || null;
  const default_buy_price = parseFloat(document.getElementById(`ip-${id}`).value || 0);
  const maxVal = document.getElementById(`im-${id}`).value;
  const sub_variants = parseVariantsText(document.getElementById(`ivar-${id}`).value);

  if (!name) return showToast('ชื่อสินค้าห้ามว่าง', 'warning');
  const { error } = await supabase.from('items').update({
    name,
    short_code,
    default_buy_price,
    max_buy_price: maxVal ? parseFloat(maxVal) : null,
    sub_variants,
    updated_at: new Date().toISOString()
  }).eq('id', id);

  if (error) return uiAlert('บันทึกไม่สำเร็จ', error.message, 'error');
  await loadOwnerView();
  showToast(`บันทึกข้อมูล "${name}" เรียบร้อย!`, 'success');
};

window.hideItem = async (id, name) => {
  const ok = await uiConfirm(`ซ่อนรายการ "${name}" ?`, 'สินค้านี้จะถูกซ่อนออกจากหน้าชั่ง POS (ข้อมูลสต็อกและบิลเก่าไม่หาย)', 'warning', 'ซ่อนสินค้า');
  if (!ok) return;
  await supabase.from('items').update({ is_active: false }).eq('id', id);
  await loadOwnerView();
  showToast(`ซ่อน "${name}" ออกจากหน้า POS แล้ว`, 'info');
};

function renderOwnerCharts(txs) {
  const catTotals = {};
  items.forEach(it => {
    const cName = it.categories?.name || 'อื่นๆ';
    catTotals[cName] = (catTotals[cName] || 0) + Number(it.current_total_cost || 0);
  });

  if (catChartInstance) catChartInstance.destroy();
  catChartInstance = new Chart(document.getElementById('chart-category'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(catTotals),
      datasets: [{ data: Object.values(catTotals), backgroundColor: ['#EA580C', '#CA8A04', '#0284C7', '#475569', '#6366F1', '#16A34A', '#A16207', '#DC2626'] }]
    },
    options: { plugins: { legend: { labels: { color: '#cbd5e1' } } } }
  });

  const days = [...Array(7)].map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const buyByDay = days.map(day => txs.filter(t => t.tx_type === 'BUY' && t.status === 'COMPLETED' && t.created_at.startsWith(day)).reduce((s, t) => s + Number(t.total_amount), 0));
  const sellByDay = days.map(day => txs.filter(t => t.tx_type === 'SELL' && t.status === 'COMPLETED' && t.created_at.startsWith(day)).reduce((s, t) => s + Number(t.total_amount), 0));

  if (flowChartInstance) flowChartInstance.destroy();
  flowChartInstance = new Chart(document.getElementById('chart-cashflow'), {
    type: 'bar',
    data: {
      labels: days.map(d => d.slice(5)),
      datasets: [
        { label: 'จ่ายรับซื้อ (฿)', data: buyByDay, backgroundColor: '#f59e0b' },
        { label: 'รับขายโรงงาน (฿)', data: sellByDay, backgroundColor: '#10b981' }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } }, plugins: { legend: { labels: { color: '#cbd5e1' } } } }
  });
}

window.adjustSafeWallet = async () => {
  const raw = await uiPrompt('ปรับยอดเงินสดในตู้เซฟ', 'ใส่เลขบวกเพื่อเติมเข้า หรือเลขติดลบเพื่อถอนออก เช่น 100000 หรือ -20000', '', 'number');
  const amt = parseFloat(raw || 0);
  if (!amt) return;
  const { error } = await supabase.from('wallet_movements').insert({
    wallet: 'SAFE',
    direction: amt > 0 ? 'IN' : 'OUT',
    category: 'CASH_IN',
    amount: Math.abs(amt),
    note: 'เจ้าของร้านปรับยอดเงินสดในเซฟ',
    created_by: currentUser.id
  });
  if (error) return uiAlert('ทำรายการไม่สำเร็จ', error.message, 'error');
  await loadOwnerView();
  showToast(`${amt > 0 ? 'เติมเงินเข้าเซฟ' : 'ถอนเงินจากเซฟ'} ${fmtMoney(Math.abs(amt))} ฿ เรียบร้อย`, 'success');
};

window.addStaffPin = async () => {
  const full_name = document.getElementById('new-u-name').value.trim();
  const role = document.getElementById('new-u-role').value;
  const pin_code = document.getElementById('new-u-pin').value.trim();
  if (!full_name || pin_code.length < 4) return showToast('กรุณากรอกชื่อและรหัส PIN อย่างน้อย 4 หลัก', 'warning');
  const { error } = await supabase.from('profiles').insert({ full_name, role, pin_code });
  if (error) return uiAlert('เพิ่มพนักงานไม่สำเร็จ', 'รหัส PIN นี้อาจซ้ำกับคนอื่น: ' + error.message, 'error');
  document.getElementById('new-u-name').value = '';
  document.getElementById('new-u-pin').value = '';
  await loadOwnerView();
  showToast(`เพิ่ม PIN ของ "${full_name}" เรียบร้อย`, 'success');
};

window.toggleUserActive = async (id, is_active) => {
  await supabase.from('profiles').update({ is_active }).eq('id', id);
  await loadOwnerView();
  showToast(is_active ? 'เปิดใช้งานบัญชีแล้ว' : 'ระงับสิทธิ์การใช้งานแล้ว', 'info');
};

window.openAddItemModal = () => {
  const sel = document.getElementById('new-item-cat');
  sel.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('add-item-modal').classList.remove('hidden');
};

window.saveNewItem = async () => {
  const name = document.getElementById('new-item-name').value.trim();
  const category_id = document.getElementById('new-item-cat').value;
  const default_buy_price = parseFloat(document.getElementById('new-item-price').value || 0);
  const maxVal = document.getElementById('new-item-max').value;
  const short_code = document.getElementById('new-item-code').value.trim();
  const sub_variants = parseVariantsText(document.getElementById('new-item-variants').value);

  if (!name || default_buy_price <= 0) return showToast('กรุณากรอกชื่อสินค้าและราคาตั้งต้น', 'warning');
  const { error } = await supabase.from('items').insert({
    name,
    category_id,
    default_buy_price,
    max_buy_price: maxVal ? parseFloat(maxVal) : null,
    short_code: short_code || null,
    sub_variants
  });
  if (error) return uiAlert('เพิ่มสินค้าไม่สำเร็จ', error.message, 'error');

  document.getElementById('add-item-modal').classList.add('hidden');
  document.getElementById('new-item-name').value = '';
  document.getElementById('new-item-price').value = '';
  document.getElementById('new-item-variants').value = '';
  await loadInitialData();
  showToast(`สร้างการ์ด "${name}" เรียบร้อย!`, 'success');
};