export const SUPABASE_URL = 'https://dplpytgciogfpiojqpjm.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_9EpPreY03SJsrAvdt4dmBg_C5PZCGS4';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function generateItemVisual(itemName = '', categoryColor = '#475569', shortCode = '') {
  const name = itemName.toLowerCase();
  const badge = (shortCode || itemName.trim().substring(0, 2)).toUpperCase();
  let iconSvg = '';

  if (name.includes('สายไฟ')) {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="3.5" stroke-linecap="round"><circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="10"/><path d="M32 14V6M50 32h8M14 32H6"/></svg>`;
  } else if (name.includes('ทองแดง') || name.includes('ทองเหลือง') || name.includes('ตะกั่ว') || name.includes('สแตนเลส')) {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="3.5" stroke-linejoin="round"><polygon points="16,44 26,24 48,24 38,44"/><polygon points="24,28 32,14 54,14 46,28"/><line x1="16" y1="44" x2="38" y2="44"/></svg>`;
  } else if (name.includes('กระป๋อง') || name.includes('อลูมิเนียม')) {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="3.5"><ellipse cx="32" cy="14" rx="14" ry="5"/><path d="M18 14v34c0 2.8 6.3 5 14 5s14-2.2 14-5V14"/><path d="M22 26h20M22 38h20"/></svg>`;
  } else if (name.includes('เหล็ก')) {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="4" stroke-linecap="round"><path d="M14 14h36M14 50h36M32 14v36M20 20v24M44 20v24"/></svg>`;
  } else if (name.includes('ขวด') || name.includes('เพ็ท') || name.includes('พลาสติก') || name.includes('pvc')) {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="3.5" stroke-linejoin="round"><rect x="26" y="8" width="12" height="6" rx="2"/><path d="M26 14l-6 10v28a4 4 0 004 4h16a4 4 0 004-4V24l-6-10"/><line x1="20" y1="32" x2="44" y2="32"/><line x1="20" y1="42" x2="44" y2="42"/></svg>`;
  } else if (name.includes('กระดาษ') || name.includes('ลัง') || name.includes('หนังสือ')) {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="3.5" stroke-linejoin="round"><path d="M12 22l20-10 20 10v22L32 54 12 44V22z"/><path d="M12 22l20 10 20-10M32 32v22M22 17l20 10"/></svg>`;
  } else if (name.includes('แบต') || name.includes('มอเตอร์') || name.includes('แอร์') || name.includes('ไฟฟ้า')) {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="3.5"><rect x="10" y="20" width="44" height="32" rx="4"/><path d="M20 20v-6h8v6M36 20v-6h8v6M20 36h8M24 32v8M38 36h8"/></svg>`;
  } else {
    iconSvg = `<svg viewBox="0 0 64 64" class="w-8 h-8 stroke-current" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M32 12l10 16H22L32 12zM14 46l10-16 10 16H14zM30 46l10-16 10 16H30z"/></svg>`;
  }

  return { color: categoryColor || '#475569', badge, iconSvg };
}

export const fmtMoney = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtWeight = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });