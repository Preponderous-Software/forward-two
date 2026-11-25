// Illustrated badges for places and feats, shared by the journal and the
// HUD's "found" and "feat" cards. No DOM, no imports: plain SVG strings.
export const ART = {
  wave: '<path d="M14 44c6-8 10 4 16-4s10 4 16-4 8 2 8 2" stroke="#8be0ff"/><path d="M14 34c6-8 10 4 16-4s10 4 16-4" stroke="#fff"/>',
  line: '<path d="M16 46c10-4 6-14 16-16s8-12 16-14" stroke="#ffd166" stroke-dasharray="4 3"/><circle cx="22" cy="30" r="3" fill="#888" stroke="none"/><circle cx="42" cy="36" r="3" fill="#888" stroke="none"/>',
  throat: '<path d="M18 14l8 36M46 14l-8 36" stroke="#a99"/><path d="M32 14v36" stroke="#fff" stroke-dasharray="3 4"/>',
  falls: '<path d="M14 22h22v26h14" stroke="#9cf"/><path d="M36 24v22M40 24v20" stroke="#fff"/><circle cx="44" cy="48" r="4" stroke="#fff"/>',
  swim: '<circle cx="32" cy="26" r="6" stroke="#ffd166"/><path d="M14 42c6-6 12 6 18 0s12 6 18 0" stroke="#8be0ff"/>',
  flow: '<path d="M14 32c6-8 12 8 18 0s12-8 18 0" stroke="#ff7a2f"/><path d="M14 40c6-8 12 8 18 0s12-8 18 0" stroke="#ffd166"/>',
  moon: '<path d="M38 16a14 14 0 1 0 8 26 12 12 0 0 1-8-26z" stroke="#ffe9a8"/><circle cx="20" cy="20" r="1.5" fill="#fff" stroke="none"/>',
  tent: '<path d="M14 46l18-28 18 28z" stroke="#ff9a3c"/><path d="M32 18v28" stroke="#ff9a3c"/>',
  map: '<path d="M14 20l12-4 12 4 12-4v28l-12 4-12-4-12 4z" stroke="#cfe"/><path d="M22 30l6 4 8-8" stroke="#ff7a2f"/>',
  crate: '<rect x="18" y="22" width="28" height="22" stroke="#c49a6c"/><path d="M18 22l28 22M46 22L18 44" stroke="#c49a6c"/>',
  medal: '<circle cx="32" cy="36" r="10" stroke="#ffd166"/><path d="M26 14l6 12 6-12" stroke="#ff7a2f"/>',
  sea: '<path d="M14 40c6-6 12 6 18 0s12 6 18 0" stroke="#4cc3ff"/><circle cx="44" cy="22" r="6" stroke="#ffd166"/>',
  camp: '<path d="M16 44l16-24 16 24z" stroke="#ff9a3c"/><path d="M28 44l4-6 4 6" stroke="#ffd166"/>',
  spring: '<path d="M20 40c0-10 24-10 24 0" stroke="#aaa"/><path d="M32 40v8" stroke="#8be0ff"/>',
  arch: '<path d="M16 46V30a16 16 0 0 1 32 0v16M24 46V32a8 8 0 0 1 16 0v14" stroke="#bbb"/>',
  hotspring: '<ellipse cx="32" cy="42" rx="14" ry="5" stroke="#8be0ff"/><path d="M26 34c-3-4 3-6 0-10M34 34c-3-4 3-6 0-10" stroke="#ddd"/>',
  bridge: '<path d="M12 30h40" stroke="#bbb"/><path d="M18 30v16M32 34v12M46 30v16" stroke="#bbb"/><path d="M36 30l6-6" stroke="#bbb"/>',
  isle: '<path d="M32 16l-8 14h16zM32 22l-10 16h20z" stroke="#5c5"/><path d="M14 44c8-4 28-4 36 0" stroke="#8be0ff"/>',
  wheel: '<circle cx="32" cy="32" r="13" stroke="#c49a6c"/><path d="M32 19v26M19 32h26M23 23l18 18M41 23L23 41" stroke="#c49a6c"/>',
  rookery: '<path d="M22 46V24M22 28l-6-6M22 30l6-6" stroke="#bbb"/><path d="M36 22c4-4 10-2 12 2-4 0-6 2-8 4" stroke="#ddd"/>',
  lighthouse: '<path d="M26 48l3-28h6l3 28z" stroke="#f66"/><path d="M38 22l12-4M38 26l12 4" stroke="#ffd166"/>',
  falls2: '<path d="M14 22h22v26h14" stroke="#9cf"/>',
  // 0.2.0: new feats, gear and river finds.
  egg: '<ellipse cx="32" cy="34" rx="10" ry="13" stroke="#fff3d6"/><path d="M20 48h24" stroke="#c49a6c"/>',
  upstream: '<path d="M14 40c6-6 12 6 18 0s12 6 18 0" stroke="#8be0ff"/><path d="M32 34V14M24 22l8-8 8 8" stroke="#ffd166"/>',
  clock: '<circle cx="32" cy="34" r="14" stroke="#fff"/><path d="M32 34V24M32 34l7 5" stroke="#ff7a2f"/><path d="M28 16h8" stroke="#fff"/>',
  lantern: '<path d="M24 22h16v20H24z" stroke="#c49a6c"/><path d="M28 18h8M32 14v4" stroke="#c49a6c"/><circle cx="32" cy="32" r="4" fill="#ffd166" stroke="none"/>',
  person: '<circle cx="32" cy="20" r="6" stroke="#ffd166"/><path d="M22 46c0-10 20-10 20 0" stroke="#ffd166"/>',
  sketch: '<rect x="16" y="16" width="32" height="32" stroke="#fff3d6"/><path d="M20 42l8-12 6 8 4-5 6 9" stroke="#9cf"/>',
  rivers: '<path d="M14 18c8 6 2 14 18 20M50 18c-8 6-2 14-18 20M32 38v12" stroke="#8be0ff"/>',
  boats: '<path d="M12 30h16l-3 5H15zM36 30h16l-3 5H39zM22 42h20l-3 5H25z" stroke="#ffd166"/>',
  descent: '<path d="M14 16l12 10 6 12 18 10" stroke="#8be0ff"/><circle cx="14" cy="16" r="3" stroke="#fff"/><path d="M44 48h8" stroke="#4cc3ff"/>',
  podium: '<path d="M14 46V34h12v12M26 46V26h12v20M38 46V38h12v8" stroke="#ffd166"/>',
  bottle: '<path d="M28 14h8v8l4 6v20H24V28l4-6z" stroke="#9be7c4"/><path d="M28 34h8M28 40h6" stroke="#fff3d6"/>',
  cup: '<path d="M20 24h20l-2 22H22z" stroke="#ccc"/><path d="M40 28c6 0 6 10 0 10" stroke="#ccc"/>',
  blade: '<path d="M32 12v26" stroke="#c49a6c"/><path d="M26 38h12l-2 12h-8z" stroke="#c49a6c"/>',
  toy: '<path d="M16 38h32l-5 7H21z" stroke="#c49a6c"/><path d="M32 38V16l12 18z" stroke="#fff"/>',
  compass: '<circle cx="32" cy="32" r="14" stroke="#ffd166"/><path d="M32 20l4 12-4 12-4-12z" stroke="#ff7a2f"/>',
  feather: '<path d="M18 48C24 30 34 18 48 14 44 28 34 40 18 48z" stroke="#ccd"/><path d="M18 48l20-24" stroke="#99a"/>',
  float: '<circle cx="32" cy="34" r="8" stroke="#f66"/><path d="M32 14v12M32 42v6" stroke="#fff"/>',
  token: '<circle cx="32" cy="32" r="13" stroke="#cd8a4b"/><path d="M26 32h12M32 26v12" stroke="#cd8a4b"/>',
  patch: '<rect x="18" y="20" width="28" height="24" rx="4" stroke="#c49a6c"/><path d="M24 26l16 12M24 38l16-12" stroke="#fff3d6" stroke-dasharray="3 3"/>',
  bag: '<path d="M20 22h24v24H20z" stroke="#4cc3ff"/><path d="M20 28h24M26 22v-4h12v4" stroke="#4cc3ff"/>',
  deck: '<path d="M12 34c10 8 30 8 40 0" stroke="#ffd166"/><path d="M18 30h28" stroke="#8be0ff"/>',
};
// Extra art for camps, so each reads as its own place.
Object.assign(ART, {
  hut: '<path d="M16 46V30l16-12 16 12v16z" stroke="#bcd"/><path d="M28 46v-9h8v9" stroke="#ffd166"/><path d="M22 34h4M38 34h4" stroke="#bcd"/>',
  lodge: '<path d="M14 30l18-14 18 14" stroke="#e8a35c"/><path d="M18 28v18h28V28" stroke="#c49a6c"/><path d="M18 34h28M18 40h28" stroke="#8a6a48"/><path d="M38 18v-4" stroke="#ddd"/>',
  town: '<path d="M10 46V32l8-7 8 7v14M26 46V28l9-8 9 8v18M44 46V34l6-5 6 5v12" stroke="#f0d8b0"/><path d="M10 46h46" stroke="#4cc3ff"/>',
  dock: '<path d="M12 36h30M18 36v10M30 36v10M42 36v10" stroke="#c49a6c"/><path d="M44 30c4-4 8-4 10 0" stroke="#ff9a3c"/><path d="M12 48c6-4 12 4 18 0s12 4 18 0" stroke="#8be0ff"/>',
});
export const CAMP_ART = { tarn: "hut", lodge: "lodge", mill: "wheel", town: "town", dock: "dock" };
// A medallion: a rim in the badge's colour, a dark face with a sheen, the
// drawn icon, and (for feats) ribbon tails. Locked feats show a faint
// silhouette; unfound places a question mark.
export const badge = (icon, on, { ring = "#ffd166", feat = false } = {}) => {
  const face = on ? "#173a4d" : "#1a1f22", rim = on ? ring : "#454b4f";
  const tails = feat ? `<path d="M22 50l-5 12 7-3 4 5 3-12z" fill="${on ? "#ff7a2f" : "#33383b"}" stroke="none"/><path d="M42 50l5 12-7-3-4 5-3-12z" fill="${on ? "#e0562a" : "#2c3134"}" stroke="none"/>` : "";
  const art = on ? ART[icon] || "" : feat ? `<g opacity=".28" style="filter:grayscale(1)">${ART[icon] || ""}</g>` : '<text x="32" y="41" font-size="24" font-weight="800" text-anchor="middle" fill="#5d666b" stroke="none">?</text>';
  return `<svg class="badge${on ? " on" : ""}" viewBox="0 0 64 68" style="width:72px;height:76px">${tails}<circle cx="32" cy="32" r="30" fill="${rim}" stroke="none"/><circle cx="32" cy="32" r="26.5" fill="${face}" stroke="none"/>${on ? '<path d="M12 26a21 21 0 0 1 40 0" stroke="#fff" stroke-opacity=".12" stroke-width="5" fill="none"/>' : ""}<circle cx="32" cy="32" r="26.5" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.5"/><g fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${art}</g></svg>`;
};
const hex = (c) => "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
// A camp's or landmark's badge: camps in their flag's colour, landmarks in river blue.
export const placeIcon = (p) => (p.kind ? (p.kind === "falls" ? "falls" : p.kind === "throat" ? "throat" : p.kind) : CAMP_ART[p.id] || "camp");
export const placeBadge = (p, on = true) => badge(placeIcon(p), on, { ring: p.kind ? "#8be0ff" : p.flag ? hex(p.flag) : "#ff9a3c" });
