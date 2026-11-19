// Rezept → Zutatenliste, Allergene und Hinweise für einen Artikel.
// Diese Datei ist in den Repos Rezepte und Artikel identisch – Änderungen immer in beiden nachführen.
//
// - Teilrezepte werden aufgelöst: Ein Teilrezept mit 500 g im Rezept trägt seine Zutaten
//   im Verhältnis 500 g / Teiggewicht des Teilrezepts bei.
// - Die Zutatenliste ist nach Gesamtmenge sortiert (grösste zuerst), mit der Deklaration der Zutat
//   (leer = Name). Gleiche Zutaten aus verschiedenen Teilrezepten werden zusammengezählt.
// - Mengen in ml zählen wie Gramm. Mengen in Stk brauchen bei der Zutat das «Gewicht pro Stück»,
//   sonst stimmt die Reihenfolge nicht genau (Warnung).
// - Allergene: «Enthält» schlägt «Spuren». Hinweise: vegan / vegetarisch nur, wenn alle Zutaten es sind;
//   Schweinefett, sobald eine Zutat es enthält.

import { db } from "./firebase-config.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const REZEPT_EINHEITEN = ["g", "ml", "Stk"];

// Löst ein Rezept in Zutaten auf. Ergebnis: { mengen: Map(zutatId → Gramm), warnungen: [], fehler: "" }
export function aufloesen(rezeptId, rezepte, zutaten) {
  const rMap = new Map(rezepte.map((r) => [r.id, r]));
  const zMap = new Map(zutaten.map((z) => [z.id, z]));
  const mengen = new Map();
  const warnungen = new Set();
  let fehler = "";

  function schritt(id, faktor, pfad) {
    const r = rMap.get(id);
    if (!r) { fehler = "Ein verwendetes Teilrezept gibt es nicht mehr."; return; }
    if (pfad.includes(id)) { fehler = `Teilrezept-Schleife: «${r.name}» enthält sich selbst.`; return; }
    for (const zeile of r.zeilen || []) {
      const menge = Number(zeile.menge) || 0;
      if (zeile.art === "rezept") {
        const sub = rMap.get(zeile.id);
        if (!sub) { fehler = `In «${r.name}» fehlt ein Teilrezept.`; continue; }
        if (!(sub.teiggewicht > 0)) { fehler = `Teilrezept «${sub.name}» hat kein Teiggewicht.`; continue; }
        schritt(zeile.id, faktor * menge / sub.teiggewicht, [...pfad, id]);
      } else {
        const z = zMap.get(zeile.id);
        if (!z) { fehler = `In «${r.name}» fehlt eine Zutat (gelöscht?).`; continue; }
        let gramm = menge;
        if (zeile.einheit === "Stk") {
          if (z.gewichtStk > 0) gramm = menge * z.gewichtStk;
          else { gramm = 0; warnungen.add(`«${z.name}»: Gewicht pro Stück fehlt – Reihenfolge der Zutatenliste ungenau.`); }
        }
        mengen.set(z.id, (mengen.get(z.id) || 0) + gramm * faktor);
      }
    }
  }
  schritt(rezeptId, 1, []);
  return { mengen, warnungen: [...warnungen], fehler };
}

// Angaben für einen Artikel: { zutaten: "…", allergene: {key: stufe}, hinweise: {…}, warnungen, fehler }
export function deklaration(rezeptId, rezepte, zutaten) {
  const { mengen, warnungen, fehler } = aufloesen(rezeptId, rezepte, zutaten);
  const zMap = new Map(zutaten.map((z) => [z.id, z]));
  const liste = [...mengen.entries()]
    .map(([id, g]) => ({ z: zMap.get(id), g }))
    .filter((x) => x.z)
    .sort((a, b) => b.g - a.g || a.z.name.localeCompare(b.z.name, "de"));

  const allergene = {};
  for (const { z } of liste) {
    for (const [key, stufe] of Object.entries(z.allergene || {})) {
      if (stufe === "enthalten" || (stufe === "spuren" && allergene[key] !== "enthalten")) allergene[key] = stufe;
    }
  }
  const alle = (key) => liste.length > 0 && liste.every(({ z }) => z.hinweise?.[key] === true);
  const hinweise = {
    schweinefett: liste.some(({ z }) => z.hinweise?.schweinefett === true),
    vegetarisch: alle("vegetarisch") || alle("vegan"),
    vegan: alle("vegan"),
  };
  return {
    zutaten: liste.map(({ z }) => (z.deklaration || "").trim() || z.name).join(", "),
    allergene,
    hinweise,
    warnungen,
    fehler,
  };
}

// Vergleich unabhängig von der Reihenfolge der Schlüssel
const sortiert = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));
export function gleicheAngaben(artikel, d) {
  return (artikel.zutaten || "") === d.zutaten &&
    sortiert(artikel.allergene) === sortiert(d.allergene) &&
    sortiert(artikel.hinweise) === sortiert(d.hinweise);
}

// Alle Artikel mit Rezept, deren gespeicherte Angaben nicht mehr zum Rezept passen.
// Ergebnis: [{ artikel, angaben }] – das Schreiben übernimmt die App (nur Admin).
export function veralteteArtikel(artikel, rezepte, zutaten) {
  const out = [];
  for (const a of artikel) {
    if (!a.rezeptId) continue;
    if (!rezepte.some((r) => r.id === a.rezeptId)) continue; // Rezept fehlt: nichts überschreiben
    const d = deklaration(a.rezeptId, rezepte, zutaten);
    if (d.fehler) continue;
    if (!gleicheAngaben(a, d)) out.push({ artikel: a, angaben: d });
  }
  return out;
}

// Artikel mit Rezept: Zutatenliste, Allergene und Hinweise in den Artikel schreiben, wenn sich ein Rezept
// oder eine Zutat geändert hat (läuft in beiden Apps, nur beim Admin). Die Abteilungen lesen nur den Artikel.
// daten = { rezepte, zutaten, artikel } (je null, solange nicht geladen). Gibt eine Funktion zurück,
// die nach jeder Änderung aufgerufen wird.
export function artikelAbgleich(daten, isAdmin, wer) {
  let timer = null;
  const inArbeit = new Map(); // artikelId → Angaben, die gerade geschrieben werden
  async function laufen() {
    if (!isAdmin || !daten.rezepte || !daten.zutaten || !daten.artikel) return;
    for (const { artikel, angaben } of veralteteArtikel(daten.artikel, daten.rezepte, daten.zutaten)) {
      const sig = JSON.stringify(angaben);
      if (inArbeit.get(artikel.id) === sig) continue;
      inArbeit.set(artikel.id, sig);
      try {
        await updateDoc(doc(db, "artikel", artikel.id), {
          zutaten: angaben.zutaten, allergene: angaben.allergene, hinweise: angaben.hinweise,
          rezeptAbgleichAm: serverTimestamp(), rezeptAbgleichVon: wer,
        });
      } catch (e) {
        console.error("Abgleich Artikel", artikel.name, e);
      } finally {
        setTimeout(() => inArbeit.delete(artikel.id), 10000);
      }
    }
  }
  return () => { clearTimeout(timer); timer = setTimeout(laufen, 1200); };
}
