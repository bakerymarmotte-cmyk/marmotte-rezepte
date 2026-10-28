import { db } from "./firebase-config.js";
import {
  addDoc, collection, doc, updateDoc, deleteDoc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { chf, parseChf, toInput, esc } from "./geld.js";
import { ALLERGENE, HINWEISE } from "./stammdaten.js";
import { toast, openModal, closeModal } from "./ui.js";

// Zutaten: Liste, Detail und (für den Admin) Bearbeiten.
// Der Einkaufspreis liegt getrennt in «zutatenPreise/<zutatId>», damit die Backstube ihn nicht lesen kann.
export function initZutaten(session) {
  const isAdmin = session.profile.role === "admin";
  let zutaten = [];
  let lieferanten = [];
  let preise = {};
  let offen = null;
  let bearbeite = null;

  const f = (id) => document.getElementById(id);
  const listEl = f("z-list");
  const sucheEl = f("z-suche");
  const liefFilterEl = f("z-filter-lieferant");
  const allFilterEl = f("z-filter-allergen");
  const inaktivEl = f("z-inaktive");

  allFilterEl.innerHTML = '<option value="">Alle Allergene</option>' +
    '<option value="__ohne">Ohne Allergene</option>' +
    ALLERGENE.map((x) => `<option value="${x.key}">enthält ${esc(x.kurz)}</option>`).join("");
  [sucheEl, liefFilterEl, allFilterEl, inaktivEl].forEach((el) => el.addEventListener("input", render));

  // ---------- Hilfen ----------
  const liefName = (z) => lieferanten.find((l) => l.id === z.lieferantId)?.name || "";
  const allergenListe = (z, stufe) => ALLERGENE.filter((x) => z.allergene?.[x.key] === stufe);
  const preisText = (id) => (preise[id]?.preis != null ? `${chf(preise[id].preis)} / ${preise[id].einheit}` : "");

  // ---------- Liste ----------
  function gefiltert() {
    const q = sucheEl.value.trim().toLowerCase();
    return zutaten.filter((z) =>
      (!isAdmin || inaktivEl.checked || z.active !== false) &&
      (!liefFilterEl.value || z.lieferantId === liefFilterEl.value) &&
      (!allFilterEl.value ||
        (allFilterEl.value === "__ohne" ? !Object.keys(z.allergene || {}).length : z.allergene?.[allFilterEl.value] === "enthalten")) &&
      (!q || z.name.toLowerCase().includes(q) || (z.deklaration || "").toLowerCase().includes(q))
    );
  }

  function render() {
    const rows = gefiltert().sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name, "de"));
    f("z-anzahl").textContent = `${rows.length} ${rows.length === 1 ? "Zutat" : "Zutaten"}`;
    if (!zutaten.length) { listEl.innerHTML = '<p class="hint-text">Noch keine Zutaten erfasst.</p>'; return; }
    if (!rows.length) { listEl.innerHTML = '<p class="hint-text">Keine Zutaten gefunden.</p>'; return; }
    listEl.innerHTML = rows.map((z) => {
      const sub = [liefName(z), z.herkunft].filter(Boolean).join(" · ");
      const enth = allergenListe(z, "enthalten").map((x) => x.kurz);
      const spur = allergenListe(z, "spuren").map((x) => x.kurz);
      const hw = HINWEISE.filter((h) => z.hinweise?.[h.key]).map((h) => h.label);
      return `
      <button class="art-item ${z.active === false ? "is-inactive" : ""}" data-id="${z.id}" type="button">
        <div class="ai-main">
          <div class="ai-name">${esc(z.name)}${hw.map((h) => ` <span class="tag-saison">${esc(h)}</span>`).join("")}${z.active === false ? ' <span class="tag-aus">inaktiv</span>' : ""}</div>
          ${sub ? `<div class="ai-sub">${esc(sub)}</div>` : ""}
          ${enth.length ? `<div class="ai-allerg">${esc(enth.join(" · "))}</div>` : ""}
          ${spur.length ? `<div class="ai-sub">Spuren: ${esc(spur.join(", "))}</div>` : ""}
        </div>
        ${isAdmin && preisText(z.id) ? `<div class="ai-preise"><span class="mono ai-preis-kg">${preisText(z.id)}</span></div>` : ""}
      </button>`;
    }).join("");
  }

  listEl.addEventListener("click", (e) => {
    const b = e.target.closest(".art-item");
    if (b) zeigeDetail(zutaten.find((z) => z.id === b.dataset.id));
  });

  // ---------- Detail ----------
  function zeigeDetail(z) {
    if (!z) return;
    offen = z;
    const enth = allergenListe(z, "enthalten");
    const spur = allergenListe(z, "spuren");
    const l = lieferanten.find((x) => x.id === z.lieferantId);
    const zeile = (label, wert) => (wert ? `<span>${label}</span><span>${wert}</span>` : "");
    f("z-detail-body").innerHTML = `
      <div class="detail-head">
        <div class="m-tint m-tint-orange"><i data-icon="package"></i></div>
        <div>
          <h3>${esc(z.name)}</h3>
          <div class="li-sub">Zutat${z.active === false ? " · inaktiv" : ""}</div>
        </div>
      </div>
      <div class="detail-grid">
        ${zeile("Lieferant", esc(l?.name || ""))}
        ${zeile("Herkunft", esc(z.herkunft || ""))}
        ${isAdmin ? zeile("Einkaufspreis", preisText(z.id) ? `CHF ${preisText(z.id)}` : "–") : ""}
      </div>
      <div class="detail-block">
        <div class="db-title">Deklaration</div>
        <p class="zutaten-text">${esc(z.deklaration || z.name)}</p>
      </div>
      <div class="detail-block">
        <div class="db-title">Allergene</div>
        ${enth.length ? `<div class="allerg-line"><span class="al-label">Enthält</span><div class="badge-row">${enth.map((x) => `<span class="al-badge al-enth">${esc(x.label)}</span>`).join("")}</div></div>` : ""}
        ${spur.length ? `<div class="allerg-line"><span class="al-label">Kann Spuren enthalten</span><div class="badge-row">${spur.map((x) => `<span class="al-badge al-spur">${esc(x.label)}</span>`).join("")}</div></div>` : ""}
        ${!enth.length && !spur.length ? '<p class="hint-text" style="margin:0;">Keine Allergene erfasst.</p>' : ""}
      </div>
      <div class="detail-block">
        <div class="db-title">Nützliche Hinweise</div>
        <div class="hinweis-liste">${HINWEISE.map((h) => `<span class="hw ${z.hinweise?.[h.key] ? "hw-ja" : ""}">${esc(h.label)}: <strong>${z.hinweise?.[h.key] ? "Ja" : "Nein"}</strong></span>`).join("")}</div>
      </div>
      ${z.updatedBy ? `<p class="hint-text" style="margin:14px 0 0;">Zuletzt bearbeitet von ${esc(z.updatedBy)}${z.updatedAt?.toDate ? ` am ${z.updatedAt.toDate().toLocaleDateString("de-CH")}` : ""}</p>` : ""}`;
    openModal("z-detail-modal");
  }
  f("z-detail-close").addEventListener("click", () => closeModal("z-detail-modal"));

  function fuelleLieferantFilter() {
    const aktuell = liefFilterEl.value;
    liefFilterEl.innerHTML = '<option value="">Alle Lieferanten</option>' +
      lieferanten.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
    liefFilterEl.value = lieferanten.some((l) => l.id === aktuell) ? aktuell : "";
  }

  const api = {
    setZutaten(list) {
      zutaten = list;
      render();
      if (offen && f("z-detail-modal").classList.contains("active")) {
        const neu = list.find((z) => z.id === offen.id);
        if (neu) zeigeDetail(neu); else closeModal("z-detail-modal");
      }
    },
    setLieferanten(list) { lieferanten = list; fuelleLieferantFilter(); render(); },
    setPreise(p) { preise = p; render(); },
  };
  if (!isAdmin) return api;

  // ---------- Bearbeiten (nur Admin) ----------
  f("z-allergene").innerHTML = ALLERGENE.map((x) => `
    <div class="allergen-row" data-key="${x.key}">
      <span class="ar-label">${esc(x.label)}</span>
      <div class="seg">
        <button type="button" data-stufe="">Nein</button>
        <button type="button" data-stufe="spuren">Spuren</button>
        <button type="button" data-stufe="enthalten">Enthält</button>
      </div>
    </div>`).join("");
  f("z-allergene").addEventListener("click", (e) => {
    const b = e.target.closest(".seg button");
    if (!b) return;
    setzeAllergen(b.closest(".allergen-row").dataset.key, b.dataset.stufe);
  });
  function setzeAllergen(key, stufe) {
    const row = f("z-allergene").querySelector(`[data-key="${key}"]`);
    row.dataset.stufe = stufe || "";
    row.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.stufe === (stufe || "")));
  }

  f("z-hinweise").innerHTML = HINWEISE.map((h) => `
    <div class="allergen-row hinweis-row" data-key="${h.key}">
      <span class="ar-label">${esc(h.label)}</span>
      <div class="seg">
        <button type="button" data-ja="0">Nein</button>
        <button type="button" data-ja="1">Ja</button>
      </div>
    </div>`).join("");
  function setzeHinweis(key, ja) {
    const row = f("z-hinweise").querySelector(`[data-key="${key}"]`);
    row.dataset.ja = ja ? "1" : "0";
    row.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.ja === row.dataset.ja));
  }
  f("z-hinweise").addEventListener("click", (e) => {
    const b = e.target.closest(".seg button");
    if (!b) return;
    const key = b.closest(".hinweis-row").dataset.key;
    const ja = b.dataset.ja === "1";
    setzeHinweis(key, ja);
    // Logisch zusammenhängende Angaben gleich mitsetzen (wie in der Artikel-App)
    if (ja && key === "vegan") { setzeHinweis("vegetarisch", true); setzeHinweis("schweinefett", false); }
    if (ja && key === "vegetarisch") setzeHinweis("schweinefett", false);
    if (ja && key === "schweinefett") { setzeHinweis("vegetarisch", false); setzeHinweis("vegan", false); }
    if (!ja && key === "vegetarisch") setzeHinweis("vegan", false);
  });

  function oeffneFormular(z) {
    bearbeite = z || null;
    f("z-edit-title").textContent = z ? "Zutat bearbeiten" : "Neue Zutat";
    f("z-edit-error").textContent = "";
    f("z-name").value = z?.name || "";
    f("z-deklaration").value = z?.deklaration || "";
    f("z-lieferant").innerHTML = '<option value="">– kein Lieferant –</option>' +
      lieferanten.filter((l) => l.active !== false || l.id === z?.lieferantId)
        .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
    f("z-lieferant").value = z?.lieferantId || "";
    f("z-herkunft").value = z?.herkunft || "";
    f("z-preis").value = z ? toInput(preise[z.id]?.preis) : "";
    f("z-preis-einheit").value = (z && preise[z.id]?.einheit) || "kg";
    ALLERGENE.forEach((x) => setzeAllergen(x.key, z?.allergene?.[x.key]));
    HINWEISE.forEach((h) => setzeHinweis(h.key, z?.hinweise?.[h.key] === true));
    f("z-edit-extra").style.display = z ? "flex" : "none";
    if (z) f("z-edit-toggle").textContent = z.active === false ? "Wieder aktivieren" : "Deaktivieren";
    closeModal("z-detail-modal");
    openModal("z-edit-modal");
    if (!z) setTimeout(() => f("z-name").focus(), 50);
  }

  f("z-neu").addEventListener("click", () => oeffneFormular(null));
  f("z-detail-edit").addEventListener("click", () => oeffneFormular(offen));
  f("z-edit-cancel").addEventListener("click", () => closeModal("z-edit-modal"));

  f("z-edit-save").addEventListener("click", async () => {
    const err = f("z-edit-error");
    err.textContent = "";
    const name = f("z-name").value.trim();
    if (!name) { err.textContent = "Bitte einen Namen eingeben."; return; }
    if (zutaten.some((z) => z.name.toLowerCase() === name.toLowerCase() && z.id !== bearbeite?.id)) {
      err.textContent = "Es gibt bereits eine Zutat mit diesem Namen."; return;
    }
    const preis = parseChf(f("z-preis").value);
    if (Number.isNaN(preis)) { err.textContent = "«Einkaufspreis» ist keine gültige Zahl."; return; }

    const allergene = {};
    f("z-allergene").querySelectorAll(".allergen-row").forEach((r) => { if (r.dataset.stufe) allergene[r.dataset.key] = r.dataset.stufe; });
    const hinweise = {};
    f("z-hinweise").querySelectorAll(".hinweis-row").forEach((r) => { hinweise[r.dataset.key] = r.dataset.ja === "1"; });

    const wer = session.profile.name || "";
    const daten = {
      name,
      deklaration: f("z-deklaration").value.trim(),
      lieferantId: f("z-lieferant").value,
      herkunft: f("z-herkunft").value.trim(),
      allergene,
      hinweise,
      updatedAt: serverTimestamp(),
      updatedBy: wer,
    };

    const btn = f("z-edit-save");
    btn.disabled = true;
    try {
      let id = bearbeite?.id;
      if (bearbeite) await updateDoc(doc(db, "zutaten", id), daten);
      else id = (await addDoc(collection(db, "zutaten"), { ...daten, active: true, createdAt: serverTimestamp() })).id;

      // Preis separat speichern (oder entfernen, wenn leer)
      const alt = preise[id];
      const einheit = f("z-preis-einheit").value;
      if (preis === null) { if (alt) await deleteDoc(doc(db, "zutatenPreise", id)); }
      else if (!alt || alt.preis !== preis || alt.einheit !== einheit) {
        await setDoc(doc(db, "zutatenPreise", id), { preis, einheit, updatedAt: serverTimestamp(), updatedBy: wer });
      }
      toast(bearbeite ? `«${name}» gespeichert` : `«${name}» angelegt`);
      closeModal("z-edit-modal");
    } catch (e) {
      console.error(e);
      err.textContent = "Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.";
    } finally {
      btn.disabled = false;
    }
  });

  f("z-edit-toggle").addEventListener("click", async () => {
    if (!bearbeite) return;
    const neu = bearbeite.active === false;
    if (!neu && !confirm(`«${bearbeite.name}» deaktivieren? Sie kann dann in neuen Rezepten nicht mehr gewählt werden.`)) return;
    try {
      await updateDoc(doc(db, "zutaten", bearbeite.id), { active: neu, updatedAt: serverTimestamp(), updatedBy: session.profile.name || "" });
      toast(neu ? "Zutat aktiviert" : "Zutat deaktiviert");
      closeModal("z-edit-modal");
    } catch (e) { console.error(e); toast("Ändern fehlgeschlagen"); }
  });

  f("z-edit-delete").addEventListener("click", async () => {
    if (!bearbeite) return;
    if (!confirm(`«${bearbeite.name}» endgültig löschen? Das kann nicht rückgängig gemacht werden.\n\nTipp: «Deaktivieren» blendet die Zutat nur aus.`)) return;
    try {
      await deleteDoc(doc(db, "zutaten", bearbeite.id));
      if (preise[bearbeite.id]) await deleteDoc(doc(db, "zutatenPreise", bearbeite.id));
      toast("Zutat gelöscht");
      closeModal("z-edit-modal");
    } catch (e) { console.error(e); toast("Löschen fehlgeschlagen"); }
  });

  return api;
}
