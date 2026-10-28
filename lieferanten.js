import { db } from "./firebase-config.js";
import {
  addDoc, collection, doc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./geld.js";
import { toast } from "./ui.js";

// Lieferanten: Liste für alle (Admin und Backstube), Bearbeiten nur für den Admin.
export function initLieferanten(session) {
  const isAdmin = session.profile.role === "admin";
  let lieferanten = [];
  let zutaten = [];
  let bearbeiteId = null;

  const f = (id) => document.getElementById(id);
  const felder = ["l-name", "l-kontakt", "l-telefon", "l-email", "l-notiz"];
  const listEl = f("l-list");

  const anzahl = (id) => zutaten.filter((z) => z.lieferantId === id).length;

  function formularLeeren() {
    bearbeiteId = null;
    felder.forEach((id) => (f(id).value = ""));
    f("l-error").textContent = "";
    f("l-form-title").textContent = "Neuer Lieferant";
    f("l-speichern").textContent = "Lieferant anlegen";
    f("l-abbrechen").style.display = "none";
  }

  function render() {
    if (!lieferanten.length) { listEl.innerHTML = '<p class="hint-text">Noch keine Lieferanten erfasst.</p>'; return; }
    listEl.innerHTML = lieferanten.map((l) => `
      <div class="list-item ${l.active === false ? "is-inactive" : ""}">
        <div class="li-main">
          <strong>${esc(l.name)}</strong>
          <span class="li-kontakt">
            ${l.kontakt ? `<span>${esc(l.kontakt)}</span>` : ""}
            ${l.telefon ? `<a href="tel:${esc(l.telefon.replace(/\s/g, ""))}">${esc(l.telefon)}</a>` : ""}
            ${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}
          </span>
          ${l.notiz ? `<span class="li-beschr">${esc(l.notiz)}</span>` : ""}
          <span class="li-sub">${anzahl(l.id)} Zutaten${l.active === false ? " · inaktiv" : ""}</span>
        </div>
        ${isAdmin ? `
        <div class="li-actions li-wrap">
          <button class="icon-btn" data-edit="${l.id}" title="Bearbeiten"><i data-icon="pencil" data-size="15"></i></button>
          <button class="btn btn-secondary btn-small" data-toggle="${l.id}">${l.active === false ? "Aktivieren" : "Deaktivieren"}</button>
        </div>` : ""}
      </div>`).join("");
  }

  const api = {
    setLieferanten(list) { lieferanten = list; render(); },
    setZutaten(list) { zutaten = list; render(); },
  };
  if (!isAdmin) return api;

  f("l-speichern").addEventListener("click", async () => {
    const err = f("l-error");
    err.textContent = "";
    const name = f("l-name").value.trim();
    if (!name) { err.textContent = "Bitte einen Namen eingeben."; return; }
    if (lieferanten.some((l) => l.name.toLowerCase() === name.toLowerCase() && l.id !== bearbeiteId)) {
      err.textContent = "Diesen Lieferanten gibt es schon."; return;
    }
    const daten = {
      name,
      kontakt: f("l-kontakt").value.trim(),
      telefon: f("l-telefon").value.trim(),
      email: f("l-email").value.trim(),
      notiz: f("l-notiz").value.trim(),
      updatedAt: serverTimestamp(),
    };
    f("l-speichern").disabled = true;
    try {
      if (bearbeiteId) { await updateDoc(doc(db, "lieferanten", bearbeiteId), daten); toast("Lieferant gespeichert"); }
      else { await addDoc(collection(db, "lieferanten"), { ...daten, active: true, createdAt: serverTimestamp() }); toast("Lieferant angelegt"); }
      formularLeeren();
    } catch (e) {
      console.error(e);
      err.textContent = "Speichern fehlgeschlagen.";
    } finally {
      f("l-speichern").disabled = false;
    }
  });
  f("l-abbrechen").addEventListener("click", formularLeeren);

  listEl.addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]");
    const tg = e.target.closest("[data-toggle]");
    if (ed) {
      const l = lieferanten.find((x) => x.id === ed.dataset.edit);
      bearbeiteId = l.id;
      f("l-name").value = l.name;
      f("l-kontakt").value = l.kontakt || "";
      f("l-telefon").value = l.telefon || "";
      f("l-email").value = l.email || "";
      f("l-notiz").value = l.notiz || "";
      f("l-error").textContent = "";
      f("l-form-title").textContent = "Lieferant bearbeiten";
      f("l-speichern").textContent = "Speichern";
      f("l-abbrechen").style.display = "inline-flex";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (tg) {
      const l = lieferanten.find((x) => x.id === tg.dataset.toggle);
      const neu = l.active === false;
      if (!neu && !confirm(`«${l.name}» deaktivieren? Er kann dann bei Zutaten nicht mehr gewählt werden.`)) return;
      try { await updateDoc(doc(db, "lieferanten", l.id), { active: neu, updatedAt: serverTimestamp() }); }
      catch (err) { console.error(err); toast("Ändern fehlgeschlagen"); }
    }
  });

  return api;
}
