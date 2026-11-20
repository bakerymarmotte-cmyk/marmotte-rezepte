import { db } from "./firebase-config.js";
import {
  addDoc, collection, doc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./geld.js";
import { toast, openModal, closeModal } from "./ui.js";

// Kategorien der Zutaten (Sammlung «zutatKategorien»: { name, reihenfolge }).
// Der Admin verwaltet sie im Fenster «Kategorien» (Tab Zutaten). Ist die Sammlung beim
// ersten Öffnen leer, werden die Standard-Kategorien angelegt.
export const STANDARD_KATEGORIEN = [
  "Mehl & Getreide", "Milchprodukte", "Eier", "Zucker & Süssungsmittel", "Fette & Öle",
  "Nüsse & Samen", "Schokolade & Kakao", "Früchte", "Gewürze", "Backhilfsmittel",
];

export const sortiereKategorien = (list) =>
  [...list].sort((a, b) => (a.reihenfolge ?? 999) - (b.reihenfolge ?? 999) || a.name.localeCompare(b.name, "de"));

// Zutaten nach Kategorie gruppieren: [{ id, name, zutaten }] in Kategorie-Reihenfolge, «Ohne Kategorie» zuletzt
export function nachKategorie(zutaten, kategorien) {
  const gruppen = sortiereKategorien(kategorien).map((k) => ({ id: k.id, name: k.name, zutaten: [] }));
  const ohne = { id: "", name: "Ohne Kategorie", zutaten: [] };
  for (const z of zutaten) (gruppen.find((g) => g.id === z.kategorieId) || ohne).zutaten.push(z);
  return [...gruppen, ohne].filter((g) => g.zutaten.length);
}

export function initKategorien(session) {
  const isAdmin = session.profile.role === "admin";
  let kategorien = [];
  let zutaten = [];
  let geladen = false;
  let standardAngelegt = false;

  const f = (id) => document.getElementById(id);
  const api = {
    setKategorien(list) { kategorien = sortiereKategorien(list); geladen = true; standardPruefen(); render(); },
    setZutaten(list) { zutaten = list; standardPruefen(); render(); },
  };
  if (!isAdmin) return api;

  const anzahl = (id) => zutaten.filter((z) => z.kategorieId === id).length;

  // Einmalig Standard-Kategorien anlegen (nur wenn noch keine existieren und keine Zutat eine Kategorie hat)
  async function standardPruefen() {
    if (!geladen || standardAngelegt || kategorien.length || zutaten.some((z) => z.kategorieId)) return;
    standardAngelegt = true;
    try {
      const batch = writeBatch(db);
      STANDARD_KATEGORIEN.forEach((name, i) => {
        batch.set(doc(collection(db, "zutatKategorien")), { name, reihenfolge: i, createdAt: serverTimestamp() });
      });
      await batch.commit();
    } catch (e) { console.error(e); standardAngelegt = false; }
  }

  function render() {
    const el = f("kat-liste");
    if (!el) return;
    el.innerHTML = kategorien.length ? kategorien.map((k, i) => `
      <div class="kat-zeile" data-id="${k.id}">
        <input type="text" class="kat-name" maxlength="40" value="${esc(k.name)}" aria-label="Name der Kategorie">
        <span class="kat-anzahl hint-text">${anzahl(k.id)}</span>
        <div class="rz-knoepfe">
          <button type="button" class="icon-btn" data-aktion="hoch" aria-label="Nach oben" ${i === 0 ? "disabled" : ""}><i data-icon="chevron-up" data-size="15"></i></button>
          <button type="button" class="icon-btn" data-aktion="runter" aria-label="Nach unten" ${i === kategorien.length - 1 ? "disabled" : ""}><i data-icon="chevron-down" data-size="15"></i></button>
          <button type="button" class="icon-btn" data-aktion="weg" aria-label="Löschen"><i data-icon="trash-2" data-size="15"></i></button>
        </div>
      </div>`).join("") : '<p class="hint-text">Noch keine Kategorien.</p>';
  }

  f("z-kategorien-btn").addEventListener("click", () => { render(); openModal("kat-modal"); });
  f("kat-close").addEventListener("click", () => closeModal("kat-modal"));

  // Umbenennen beim Verlassen des Feldes
  f("kat-liste").addEventListener("change", async (e) => {
    if (!e.target.matches(".kat-name")) return;
    const id = e.target.closest(".kat-zeile").dataset.id;
    const name = e.target.value.trim();
    const k = kategorien.find((x) => x.id === id);
    if (!name) { e.target.value = k.name; return; }
    if (kategorien.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) {
      toast("Diese Kategorie gibt es schon."); e.target.value = k.name; return;
    }
    try { await updateDoc(doc(db, "zutatKategorien", id), { name }); toast("Umbenannt"); }
    catch (err) { console.error(err); toast("Umbenennen fehlgeschlagen"); }
  });

  f("kat-liste").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-aktion]");
    if (!b) return;
    const id = b.closest(".kat-zeile").dataset.id;
    const i = kategorien.findIndex((k) => k.id === id);
    try {
      if (b.dataset.aktion === "weg") {
        const n = anzahl(id);
        if (n) { alert(`«${kategorien[i].name}» enthält noch ${n} ${n === 1 ? "Zutat" : "Zutaten"}. Bitte diese zuerst einer anderen Kategorie zuordnen.`); return; }
        if (!confirm(`Kategorie «${kategorien[i].name}» löschen?`)) return;
        await deleteDoc(doc(db, "zutatKategorien", id));
        return;
      }
      const j = b.dataset.aktion === "hoch" ? i - 1 : i + 1;
      if (j < 0 || j >= kategorien.length) return;
      const neu = [...kategorien];
      [neu[i], neu[j]] = [neu[j], neu[i]];
      const batch = writeBatch(db);
      neu.forEach((k, idx) => { if (k.reihenfolge !== idx) batch.update(doc(db, "zutatKategorien", k.id), { reihenfolge: idx }); });
      await batch.commit();
    } catch (err) { console.error(err); toast("Ändern fehlgeschlagen"); }
  });

  f("kat-neu-btn").addEventListener("click", async () => {
    const input = f("kat-neu-name");
    const name = input.value.trim();
    if (!name) return;
    if (kategorien.some((k) => k.name.toLowerCase() === name.toLowerCase())) { toast("Diese Kategorie gibt es schon."); return; }
    try {
      await addDoc(collection(db, "zutatKategorien"), { name, reihenfolge: kategorien.length, createdAt: serverTimestamp() });
      input.value = "";
      input.focus();
    } catch (err) { console.error(err); toast("Anlegen fehlgeschlagen"); }
  });
  f("kat-neu-name").addEventListener("keydown", (e) => { if (e.key === "Enter") f("kat-neu-btn").click(); });

  return api;
}
