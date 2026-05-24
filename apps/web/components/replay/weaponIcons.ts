/**
 * Maps a CS2 weapon name (as it appears in the demo data) to the
 * public URL of its silhouette SVG.
 *
 * Assets are the **official Counter-Strike weapon silhouettes**
 * vectorised from Valve's ``iconlib.swf`` (the CS:GO/CS2 HUD icon
 * library). Each SVG is a wide horizontal silhouette of the weapon
 * in black, matching the style used in CS2 itself and in every
 * analytics tool in the ecosystem (HLTV, Leetify, Tracker.gg,
 * Faceit, cs2.cam, …). Source: github.com/moongunlol/csgo-icon
 * (community extract of iconlib.swf).
 *
 * Naming gotchas in CS2 engine data:
 *   • ``weapon_m4a1``           = M4A4 (no silencer)
 *   • ``weapon_m4a1_silencer``  = M4A1-S
 *   • ``weapon_sg556``          = SG 553
 *   • ``weapon_galilar``        = Galil AR
 *   • ``weapon_hkp2000``        = P2000 (German engineering name)
 *   • ``weapon_incgrenade``     = CT incendiary
 *   • ``normalizeWeaponName`` below strips dashes / spaces /
 *     ``weapon_`` prefix so both engine and display variants land
 *     on the same key.
 */
export const WEAPON_ICONS: Record<string, string> = {
  // ---- Rifles ----
  ak47:          "/weapons/ak47.svg",
  m4a1:          "/weapons/m4a1.svg",            // M4A4
  m4a1_silencer: "/weapons/m4a1_silencer.svg",   // M4A1-S
  famas:         "/weapons/famas.svg",
  galilar:       "/weapons/galilar.svg",
  aug:           "/weapons/aug.svg",
  sg556:         "/weapons/sg556.svg",           // SG 553

  // ---- Snipers ----
  awp:    "/weapons/awp.svg",
  ssg08:  "/weapons/ssg08.svg",
  scar20: "/weapons/scar20.svg",
  g3sg1:  "/weapons/g3sg1.svg",

  // ---- SMGs ----
  mac10: "/weapons/mac10.svg",
  mp9:   "/weapons/mp9.svg",
  mp7:   "/weapons/mp7.svg",
  mp5sd: "/weapons/mp5sd.svg",   // mp7 silhouette — iconlib.swf predates MP5SD
  ump45: "/weapons/ump45.svg",
  p90:   "/weapons/p90.svg",
  bizon: "/weapons/bizon.svg",

  // ---- Shotguns ----
  nova:     "/weapons/nova.svg",
  mag7:     "/weapons/mag7.svg",
  sawedoff: "/weapons/sawedoff.svg",
  xm1014:   "/weapons/xm1014.svg",

  // ---- Pistols ----
  glock:        "/weapons/glock.svg",
  usp_silencer: "/weapons/usp_silencer.svg",
  p2000:        "/weapons/p2000.svg",
  hkp2000:      "/weapons/hkp2000.svg",
  p250:         "/weapons/p250.svg",
  fiveseven:    "/weapons/fiveseven.svg",
  tec9:         "/weapons/tec9.svg",
  cz75a:        "/weapons/cz75a.svg",
  deagle:       "/weapons/deagle.svg",
  elite:        "/weapons/elite.svg",            // dual Berettas
  revolver:     "/weapons/revolver.svg",         // R8 Revolver

  // ---- Knife — single generic silhouette for every variant.
  //      Knife skins (karambit, butterfly, bayonet, etc.) all map
  //      onto this via the ``includes("knife")`` fallback in
  //      ``weaponIconUrl``. Side-specific knife icons used to be
  //      shipped but the user preferred a single, recognisable
  //      knife silhouette across both teams.
  knife: "/weapons/knife.svg",

  // ---- Bomb ----
  c4: "/weapons/c4.svg",

  // ---- Grenades (held in hand) ----
  hegrenade:    "/weapons/hegrenade.svg",
  smokegrenade: "/weapons/smokegrenade.svg",
  flashbang:    "/weapons/flashbang.svg",
  molotov:      "/weapons/molotov.svg",
  incgrenade:   "/weapons/incgrenade.svg",
  decoy:        "/weapons/decoy.svg",
};

/**
 * Aliases — alternative engine names / display names that resolve to
 * the same icon as a key above.
 */
const WEAPON_ALIASES: Record<string, string> = {
  // ---- Rifle display names ----
  m4a4:  "m4a1",            // CS2 display name → engine name
  m4a1s: "m4a1_silencer",   // dash-stripped form of "M4A1-S"
  sg553: "sg556",
  galil: "galilar",

  // ---- Sniper aliases ----
  ssg:   "ssg08",
  scout: "ssg08",

  // ---- Pistol aliases ----
  p2k:                "p2000",
  hkp2k:              "p2000",
  usps:               "usp_silencer",
  uspsilencer:        "usp_silencer",
  uspsilenced:        "usp_silencer",
  duals:              "elite",
  dualberettas:       "elite",
  fiveseven_m4:       "fiveseven",
  fivesevenm4:        "fiveseven",
  r8:                 "revolver",
  r8revolver:         "revolver",
  // CS2 engine name for the T-side starting pistol is
  // ``weapon_glock18`` (with the model number), but the
  // public asset is named ``glock.svg``. Without this alias
  // the icon resolver returns null and the feed falls back
  // to the "GLOC" text chip — which is exactly what we saw
  // for MAWTH / PEREZ in the user's screenshot. Mapping
  // both the dashless and underscored forms covers any
  // parser variant.
  glock18:            "glock",
  glock_18:           "glock",

  // ---- Grenade short names + variants ----
  he:               "hegrenade",
  smoke:            "smokegrenade",
  flash:            "flashbang",
  // Both internal CS:GO/CS2 engine names for the CT incendiary
  // grenade (some demos emit ``inferno``, ``incendiary``,
  // ``incgrenade``, ``firegrenade`` etc.).
  inferno:          "incgrenade",
  incendiary:       "incgrenade",
  firegrenade:      "incgrenade",
  inc:              "incgrenade",
  // Molotov variants.
  molotovgrenade:   "molotov",
  // Decoy variants.
  decoygrenade:     "decoy",
  // Flash variants the parser sometimes emits with the full noun.
  flashgrenade:     "flashbang",
  flashbangs:       "flashbang",
  // HE variants.
  hegren:           "hegrenade",
  highexplosive:    "hegrenade",

  // ---- Knife skin variants — fold every CS2 knife engine name
  //      onto the single generic knife icon. The ``includes("knife")``
  //      fallback in ``weaponIconUrl`` also catches anything we
  //      forgot to enumerate here (workshop skins, etc.).
  knife_t:           "knife",
  knife_ct:          "knife",
  bayonet:           "knife",
  knife_m9_bayonet:  "knife",
  knife_bayonet:     "knife",
  knife_butterfly:   "knife",
  knife_karambit:    "knife",
  knife_falchion:    "knife",
  knife_flip:        "knife",
  knife_gut:         "knife",
  knife_push:        "knife",
  knife_tactical:    "knife",
  knife_widowmaker:  "knife",
  knifegg:           "knife",
};

/**
 * Normalise a raw weapon string to the canonical lookup key.
 *
 *   ``Weapon_AK-47`` → ``ak47``
 *   ``M4A1-S``       → ``m4a1s`` (then via alias → ``m4a1_silencer``)
 *   ``ak47``         → ``ak47``
 */
export function normalizeWeaponName(weapon: string): string {
  let w = weapon.toLowerCase();
  if (w.startsWith("weapon_")) w = w.slice("weapon_".length);
  // Strip dashes + whitespace. Keep underscores so "m4a1_silencer"
  // survives intact; aliases handle the dashed display variant.
  w = w.replace(/[\s-]/g, "");
  return w;
}

/**
 * Resolve the icon URL for a raw engine / display weapon name.
 * Returns ``null`` when no mapping exists so the caller can fall
 * back to a text chip.
 */
export function weaponIconUrl(weapon: string | null | undefined): string | null {
  if (!weapon) return null;
  const key = normalizeWeaponName(weapon);
  if (WEAPON_ICONS[key]) return WEAPON_ICONS[key];
  const aliased = WEAPON_ALIASES[key];
  if (aliased && WEAPON_ICONS[aliased]) return WEAPON_ICONS[aliased];
  // Last-ditch knife fold — any string containing "knife" gets the
  // generic knife silhouette so unusual skin names still render
  // something useful.
  if (key.includes("knife")) return WEAPON_ICONS.knife;
  return null;
}
