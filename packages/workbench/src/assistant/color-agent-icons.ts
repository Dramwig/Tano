// A standalone cast of colorful characters, independent of the outline catalog.
// Each portrait has its own silhouette and permanent ID.
const characters = [
  ['astronaut', '宇航员', `
    <rect x="4" y="10" width="24" height="16" rx="5" fill="#94a3b8"/>
    <path d="M7 30v-9h18v9" fill="#e2e8f0"/><circle cx="16" cy="14" r="13" fill="#f1f5f9"/>
    <rect x="6" y="6" width="20" height="17" rx="8" fill="#1e3a8a"/>
    <path d="M9 13c0-4 3-5 6-5" fill="none" stroke="#67e8f9" stroke-width="3" stroke-linecap="round"/>
    <circle cx="23" cy="24" r="3" fill="#f97316"/><rect x="11" y="27" width="7" height="3" rx="1" fill="#38bdf8"/>`],
  ['diver', '潜水员', `
    <path d="M5 30V15a11 11 0 0 1 22 0v15" fill="#0f766e"/><ellipse cx="16" cy="18" rx="10" ry="11" fill="#fdba74"/>
    <rect x="3" y="10" width="24" height="12" rx="5" fill="#facc15"/><rect x="6" y="12" width="18" height="8" rx="3" fill="#164e63"/>
    <path d="M8 14h6m4 0h4" stroke="#67e8f9" stroke-width="2" stroke-linecap="round"/>
    <path d="M17 26h9q3 0 3-4V5h-5" fill="none" stroke="#facc15" stroke-width="4" stroke-linejoin="round"/><circle cx="16" cy="26" r="4" fill="#334155"/>`],
  ['aviator', '飞行员', `
    <path d="M3 28V14a13 13 0 0 1 26 0v14l-6-3H9Z" fill="#9a3412"/><ellipse cx="16" cy="18" rx="9" ry="11" fill="#fed7aa"/>
    <path d="M3 11h26" stroke="#fbbf24" stroke-width="4"/><rect x="6" y="7" width="9" height="8" rx="3" fill="#bae6fd"/><rect x="17" y="7" width="9" height="8" rx="3" fill="#bae6fd"/>
    <circle cx="12" cy="20" r="1.5" fill="#431407"/><circle cx="21" cy="20" r="1.5" fill="#431407"/>
    <path d="M9 28h14l6 4H8Z" fill="#ef4444"/>`],
  ['gardener', '园丁', `
    <path d="M5 32q1-13 11-13t11 13" fill="#16a34a"/><ellipse cx="16" cy="19" rx="9" ry="10" fill="#c08457"/>
    <path d="M7 13 10 3h12l3 10" fill="#fbbf24"/><ellipse cx="16" cy="13" rx="15" ry="4" fill="#fcd34d"/>
    <path d="M9 9h14v4H9Z" fill="#b45309"/><circle cx="12" cy="20" r="1.5" fill="#422006"/><circle cx="20" cy="20" r="1.5" fill="#422006"/>
    <path d="M13 25q3 2 6 0" fill="none" stroke="#78350f" stroke-width="1.5"/><path d="M24 10c-2-8 4-8 6-8 0 5-2 8-6 8" fill="#4ade80"/>`],
  ['chef', '厨师', `
    <path d="M4 32q2-10 12-10t12 10" fill="#f1f5f9"/><ellipse cx="16" cy="20" rx="9" ry="10" fill="#f5c99f"/>
    <path d="M7 15V9C-2 5 7-4 12 2c4-5 10-2 10 2 10-3 13 8 3 10v3H7" fill="#cbd5e1"/>
    <path d="M8 13V8C1 5 7 0 12 4c3-5 9-2 9 2 7-4 12 4 3 7Z" fill="#fff"/>
    <circle cx="12" cy="20" r="1.5" fill="#44403c"/><circle cx="20" cy="20" r="1.5" fill="#44403c"/>
    <path d="m10 28 6 3 6-3" fill="none" stroke="#ef4444" stroke-width="3"/>`],
  ['detective', '侦探', `
    <path d="M4 32 8 23h16l4 9" fill="#a16207"/><ellipse cx="16" cy="19" rx="9" ry="10" fill="#e8b48b"/>
    <path d="m5 12 4-10 8 2 7-2 3 10" fill="#78716c"/><ellipse cx="16" cy="12" rx="16" ry="4" fill="#57534e"/>
    <path d="M8 9h17" stroke="#292524" stroke-width="3"/><circle cx="12" cy="20" r="1.5" fill="#292524"/>
    <path d="m25 25 5 6" stroke="#92400e" stroke-width="4"/><circle cx="22" cy="21" r="6" fill="#bae6fd" stroke="#ca8a04" stroke-width="2"/><circle cx="21" cy="20" r="2" fill="#475569"/>`],
  ['wizard', '魔法师', `
    <path d="M3 32q1-14 13-14t13 14" fill="#7c3aed"/><ellipse cx="16" cy="19" rx="8" ry="9" fill="#fcd9b6"/>
    <path d="M7 22c0 8 5 10 9 10s9-3 9-10l-9 4Z" fill="#e0e7ff"/>
    <path d="M6 15 15 0l5 5 6 10" fill="#8b5cf6"/><ellipse cx="16" cy="15" rx="15" ry="3" fill="#6d28d9"/>
    <path d="m15 5 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="#fde047"/>
    <circle cx="12" cy="20" r="1.5" fill="#4c1d95"/><circle cx="20" cy="20" r="1.5" fill="#4c1d95"/>`],
  ['knight', '骑士', `
    <path d="M16 11C7 3 13-2 25 1l-4 10" fill="#f43f5e"/><path d="M3 32q3-12 13-12t13 12" fill="#64748b"/>
    <path d="M5 14a11 11 0 0 1 22 0v12l-11 6-11-6Z" fill="#cbd5e1"/>
    <path d="M16 4v26l10-5V14A10 10 0 0 0 16 4" fill="#94a3b8"/>
    <path d="M7 14h18v5H7Z" fill="#1e293b"/><path d="M11 23v4m5-4v5m5-5v4" stroke="#475569" stroke-width="2"/>`],
  ['pirate', '海盗', `
    <path d="M4 32q1-11 12-11t12 11" fill="#ef4444"/><ellipse cx="16" cy="19" rx="10" ry="11" fill="#c98e64"/>
    <path d="M2 13 1 6l8 2Q16-5 24 8l7-2-1 7Z" fill="#334155"/><path d="M5 13h22" stroke="#fbbf24" stroke-width="2"/>
    <circle cx="16" cy="7" r="3" fill="#fff"/><path d="M14 10h4" stroke="#fff" stroke-width="2"/>
    <path d="M6 15 25 22" stroke="#1e293b" stroke-width="2"/><circle cx="12" cy="19" r="4" fill="#1e293b"/><circle cx="21" cy="19" r="1.5" fill="#292524"/>
    <circle cx="27" cy="24" r="3" fill="none" stroke="#fbbf24" stroke-width="2"/>`],
  ['ninja', '忍者', `
    <path d="M7 22 0 30l10-2m15-6 7 6-9 2" fill="#f43f5e"/><path d="M3 32V16a13 13 0 0 1 26 0v16" fill="#312e81"/>
    <path d="M5 12h22v10H5Z" fill="#f5c99f"/><path d="M3 9h26v5H3Z" fill="#ef4444"/>
    <path d="m8 16 5 2m11-2-5 2" stroke="#1e1b4b" stroke-width="2"/>
    <path d="M4 22h24v10H4Z" fill="#4338ca"/><path d="m13 24 7 8" stroke="#6366f1" stroke-width="3"/>`],
  ['artist', '画家', `
    <path d="M4 32q1-12 12-12t12 12" fill="#38bdf8"/><ellipse cx="16" cy="19" rx="9" ry="11" fill="#b7794f"/>
    <ellipse cx="15" cy="7" rx="14" ry="6" transform="rotate(-12 15 7)" fill="#f43f5e"/><path d="M17 3V0" stroke="#881337" stroke-width="3"/>
    <circle cx="12" cy="19" r="1.5" fill="#422006"/><circle cx="20" cy="19" r="1.5" fill="#422006"/>
    <ellipse cx="25" cy="27" rx="7" ry="5" fill="#fde68a"/><circle cx="22" cy="26" r="2" fill="#ef4444"/><circle cx="27" cy="25" r="2" fill="#2563eb"/><circle cx="26" cy="30" r="1.5" fill="#16a34a"/>`],
  ['medic', '医生', `
    <path d="M3 32q1-12 13-12t13 12" fill="#f1f5f9"/><path d="M6 21V11a10 10 0 0 1 20 0v10" fill="#475569"/>
    <ellipse cx="16" cy="18" rx="9" ry="11" fill="#f2bf91"/><path d="M6 13V4h20v9" fill="#e2e8f0"/>
    <path d="M16 4v8m-4-4h8" stroke="#ef4444" stroke-width="3"/>
    <circle cx="12" cy="17" r="1.5" fill="#334155"/><circle cx="20" cy="17" r="1.5" fill="#334155"/>
    <path d="M7 20h18v5l-9 5-9-5Z" fill="#67e8f9"/><path d="M11 23h10" stroke="#0891b2" stroke-width="1.5"/>`],
  ['penguin', '企鹅', `
    <path d="M6 19 0 26l7 1m19-8 6 7-7 1" fill="#334155"/><ellipse cx="16" cy="17" rx="12" ry="15" fill="#1e293b"/>
    <path d="M7 22c0-11 4-15 9-10 5-5 9-1 9 10 0 10-18 10-18 0" fill="#f1f5f9"/>
    <circle cx="11" cy="16" r="2" fill="#0f172a"/><circle cx="21" cy="16" r="2" fill="#0f172a"/>
    <path d="m12 20 4 4 4-4" fill="#fb923c"/><ellipse cx="10" cy="30" rx="5" ry="2" fill="#f59e0b"/><ellipse cx="22" cy="30" rx="5" ry="2" fill="#f59e0b"/>`],
  ['panda', '熊猫', `
    <circle cx="7" cy="7" r="6" fill="#334155"/><circle cx="25" cy="7" r="6" fill="#334155"/>
    <ellipse cx="16" cy="18" rx="14" ry="13" fill="#f8fafc" stroke="#e2e8f0"/>
    <ellipse cx="10" cy="17" rx="5" ry="6" transform="rotate(25 10 17)" fill="#334155"/><ellipse cx="22" cy="17" rx="5" ry="6" transform="rotate(-25 22 17)" fill="#334155"/>
    <circle cx="11" cy="16" r="2" fill="#fff"/><circle cx="21" cy="16" r="2" fill="#fff"/><path d="m13 23 3 3 3-3" fill="#1e293b"/>
    <path d="M24 31 30 20" stroke="#22c55e" stroke-width="3"/><path d="M27 25c-6-5-7 2 0 0" fill="#4ade80"/>`],
  ['fox', '狐狸', `
    <path d="M2 2 13 8h6L30 2l-4 20-10 9L6 22Z" fill="#f97316"/><path d="m5 6 2 9 5-6m15-3-2 9-5-6" fill="#9a3412"/>
    <path d="M4 17c7-1 12 4 12 9 0-5 5-10 12-9l-3 8-9 6-9-6Z" fill="#fff7ed"/>
    <path d="m8 17 4 2m12-2-4 2" stroke="#431407" stroke-width="2"/><path d="m12 26 4 4 4-4" fill="#431407"/>`],
  ['frog', '青蛙', `
    <ellipse cx="16" cy="21" rx="15" ry="11" fill="#4ade80"/><circle cx="8" cy="10" r="7" fill="#22c55e"/><circle cx="24" cy="10" r="7" fill="#22c55e"/>
    <circle cx="8" cy="10" r="4" fill="#f0fdf4"/><circle cx="24" cy="10" r="4" fill="#f0fdf4"/><circle cx="9" cy="10" r="2" fill="#14532d"/><circle cx="23" cy="10" r="2" fill="#14532d"/>
    <path d="M8 22q8 10 16 0" fill="#166534"/><path d="M13 26q3-4 6 0" fill="#fb7185"/><ellipse cx="5" cy="21" rx="3" ry="2" fill="#86efac"/><ellipse cx="27" cy="21" rx="3" ry="2" fill="#86efac"/>`],
  ['dinosaur', '恐龙', `
    <path d="m5 11 3-7 5 3 4-7 4 5 6-2 1 8" fill="#fbbf24"/>
    <path d="M4 31V14C4 2 29 3 29 14v10c0 5-6 7-11 5v2" fill="#14b8a6"/>
    <ellipse cx="20" cy="23" rx="10" ry="7" fill="#99f6e4"/><circle cx="11" cy="13" r="3" fill="#fff"/><circle cx="12" cy="13" r="1.5" fill="#134e4a"/>
    <circle cx="25" cy="20" r="1.5" fill="#0f766e"/><path d="M15 25h11" stroke="#0f766e" stroke-width="2"/><path d="m17 25 2 4 2-4" fill="#fff"/>`],
  ['jellyfish', '水母', `
    <path d="M8 19c-5 6 5 7 0 12m8-12c-5 6 5 7 0 12m8-12c-5 6 5 7 0 12" fill="none" stroke="#c084fc" stroke-width="3" stroke-linecap="round"/>
    <path d="M2 18a14 16 0 0 1 28 0c-4 4-7 4-10 1-3 4-6 4-9 0-3 3-6 2-9-1" fill="#f9a8d4"/>
    <path d="M5 12C8 1 21 1 26 12" fill="#fbcfe8"/><circle cx="11" cy="15" r="1.5" fill="#86198f"/><circle cx="21" cy="15" r="1.5" fill="#86198f"/>`],
  ['octopus', '章鱼', `
    <path d="M7 19c-7 2-7 12-2 12 3 0 3-5 5-5s0 6 5 6 3-6 5-6 2 5 5 5c6 0 7-9 1-12" fill="#a78bfa"/>
    <ellipse cx="16" cy="13" rx="12" ry="12" fill="#8b5cf6"/><ellipse cx="12" cy="8" rx="5" ry="3" transform="rotate(-30 12 8)" fill="#c4b5fd"/>
    <circle cx="11" cy="15" r="3" fill="#fff"/><circle cx="21" cy="15" r="3" fill="#fff"/><circle cx="12" cy="16" r="1.5" fill="#4c1d95"/><circle cx="20" cy="16" r="1.5" fill="#4c1d95"/><ellipse cx="16" cy="21" rx="2" ry="3" fill="#4c1d95"/>`],
  ['whale', '鲸鱼', `
    <path d="M20 19c8 0 3-10 12-8v9c-4 0-3 10-14 10C-3 30-3 9 9 9c10 0 10 5 11 10" fill="#38bdf8"/>
    <path d="M2 23c8 6 15 3 22 0-2 10-18 10-22 0" fill="#bae6fd"/><circle cx="9" cy="19" r="2" fill="#0c4a6e"/>
    <path d="M13 23c1 7 7 5 7 0" fill="#0284c7"/><path d="M10 8V4m0 1L6 2m4 3 4-3" stroke="#67e8f9" stroke-width="3" stroke-linecap="round"/>`],
  ['mushroom', '蘑菇精灵', `
    <path d="m12 15-3 12c-2 6 16 6 14 0l-3-12" fill="#fef3c7"/>
    <path d="M1 17C1-5 31-5 31 17c-8 5-22 5-30 0" fill="#ef4444"/>
    <ellipse cx="9" cy="11" rx="4" ry="3" transform="rotate(-30 9 11)" fill="#fff7ed"/><circle cx="22" cy="8" r="4" fill="#fff7ed"/><ellipse cx="23" cy="17" rx="3" ry="2" fill="#fecaca"/>
    <circle cx="13" cy="25" r="1.5" fill="#78350f"/><circle cx="19" cy="25" r="1.5" fill="#78350f"/>`],
  ['cactus', '仙人掌', `
    <path d="M12 26V10a5 5 0 0 1 10 0v16M12 19H7a3 3 0 0 1-3-3v-5m18 10h4a3 3 0 0 0 3-3v-4" fill="none" stroke="#22c55e" stroke-width="6" stroke-linecap="round"/>
    <path d="M8 24h19l-3 8H11Z" fill="#fb923c"/><path d="M8 24h19v3H8Z" fill="#fdba74"/>
    <circle cx="15" cy="15" r="1" fill="#14532d"/><circle cx="20" cy="15" r="1" fill="#14532d"/><path d="M15 19h4" stroke="#14532d" stroke-width="1.5"/>
    <circle cx="19" cy="4" r="4" fill="#f472b6"/><circle cx="19" cy="4" r="1.5" fill="#fde047"/>`],
  ['snowman', '雪人', `
    <ellipse cx="16" cy="25" rx="12" ry="7" fill="#e0f2fe"/><circle cx="16" cy="15" r="10" fill="#f0f9ff" stroke="#bae6fd"/>
    <path d="M8 9V1h16v8" fill="#334155"/><path d="M5 9h22" stroke="#334155" stroke-width="3" stroke-linecap="round"/><path d="M8 6h16" stroke="#f43f5e" stroke-width="3"/>
    <circle cx="12" cy="14" r="1.5" fill="#334155"/><circle cx="20" cy="14" r="1.5" fill="#334155"/><path d="m16 16 10 3-10 2" fill="#fb923c"/>
    <path d="M8 23h16m-4 0v8" stroke="#ef4444" stroke-width="4"/>`],
  ['bee', '蜜蜂', `
    <ellipse cx="9" cy="11" rx="7" ry="10" transform="rotate(-30 9 11)" fill="#bae6fd"/><ellipse cx="23" cy="11" rx="7" ry="10" transform="rotate(30 23 11)" fill="#e0f2fe"/>
    <ellipse cx="16" cy="22" rx="10" ry="10" fill="#fbbf24"/><path d="M7 25h18m-16 5h14" stroke="#422006" stroke-width="3"/>
    <path d="m12 13-3-6m11 6 3-6" stroke="#422006" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="9" fill="#fde047"/>
    <circle cx="12" cy="16" r="1.5" fill="#422006"/><circle cx="20" cy="16" r="1.5" fill="#422006"/><path d="M13 20q3 3 6 0" fill="none" stroke="#92400e" stroke-width="1.5"/>`],
] as const;

export const colorfulIcons = characters.map(([name, label, drawing]) => ({
  id: `agent-color-${name}`,
  label,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${drawing}</svg>`,
}));
