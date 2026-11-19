import { db } from "./firebase-config.js";
import {
  addDoc, collection, doc, updateDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./geld.js";
import { ALLERGENE, HINWEISE } from "./stammdaten.js";
import { deklaration, REZEPT_EINHEITEN } from "./rezeptberechnung.js";
import { toast, openModal, closeModal } from "./ui.js";

// Rezepte: Liste und Detail für Admin und Backstube, Bearbeiten nur für den Admin.
// Ein Rezept: { name, teiggewicht (g), zeilen: [{ art: "zutat"|"rezept", id, menge, einheit }], schritte: [Text], notiz }
// Teilrezepte werden immer in Gramm angegeben.
export function initRezepte(session) {
  const isAdmin = session.profile.role === "admin";
  let rezepte = [];
  let zutaten = [];
  let artikel = [];
  let offen = null;
  let bearbeite = null;

  const f = (id) => document.getElementById(id);
  const listEl = f("r-list");
  const sucheEl = f("r-suche");
  const inaktivEl = f("r-inaktive");
  [sucheEl, inaktivEl].forEach((el) => el.addEventListener("input", render));

  // ---------- Hilfen ----------
  const zahl = (n) => (Math.round(n * 10) / 10).toLocaleString("de-CH");
  const gramm = (g) => (g >= 1000 ? `${zahl(g / 1000)} kg` : `${zahl(g)} g`);
  const zeileName = (z) => (z.art === "rezept"
    ? rezepte.find((r) => r.id === z.id)?.name || "(Teilrezept fehlt)"
    : zutaten.find((x) => x.id === z.id)?.name || "(Zutat fehlt)");
  const artikelVon = (rid) => artikel.filter((a) => a.rezeptId === rid);
  const verwendetIn = (rid) => rezepte.filter((r) => r.id !== rid && (r.zeilen || []).some((z) => z.art === "rezept" && z.id === rid));
  // Summe der Zutaten in Gramm (ml = g; Stk mit Gewicht pro Stück, sonst nicht gezählt)
  function summe(zeilen) {
    let g = 0, unvollstaendig = false;
    for (const z of zeilen) {
      const m = Number(z.menge) || 0;
      if (z.art === "zutat" && z.einheit === "Stk") {
        const st = zutaten.find((x) => x.id === z.id)?.gewichtStk;
        if (st > 0) g += m * st; else unvollstaendig = true;
      } else g += m;
    }
    return { g, unvollstaendig };
  }

  // ---------- Liste ----------
  function render() {
    const q = sucheEl.value.trim().toLowerCase();
    const rows = rezepte
      .filter((r) => (!isAdmin || inaktivEl.checked || r.active !== false) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name, "de"));
    f("r-anzahl").textContent = `${rows.length} ${rows.length === 1 ? "Rezept" : "Rezepte"}`;
    if (!rezepte.length) { listEl.innerHTML = `<p class="hint-text">Noch keine Rezepte erfasst.${isAdmin && !zutaten.length ? " Lege zuerst unter «Zutaten» die Zutaten an." : ""}</p>`; return; }
    if (!rows.length) { listEl.innerHTML = '<p class="hint-text">Keine Rezepte gefunden.</p>'; return; }
    listEl.innerHTML = rows.map((r) => {
      const teil = (r.zeilen || []).filter((z) => z.art === "rezept").length;
      const sub = [
        `${(r.zeilen || []).length} ${(r.zeilen || []).length === 1 ? "Position" : "Positionen"}`,
        teil ? `${teil} ${teil === 1 ? "Teilrezept" : "Teilrezepte"}` : "",
        artikelVon(r.id).length ? `${artikelVon(r.id).length} Artikel` : "",
      ].filter(Boolean).join(" · ");
      const enth = ALLERGENE.filter((x) => deklaration(r.id, rezepte, zutaten).allergene[x.key] === "enthalten").map((x) => x.kurz);
      return `
      <button class="art-item ${r.active === false ? "is-inactive" : ""}" data-id="${r.id}" type="button">
        <div class="ai-main">
          <div class="ai-name">${esc(r.name)}${r.active === false ? ' <span class="tag-aus">inaktiv</span>' : ""}</div>
          <div class="ai-sub">${esc(sub)}</div>
          ${enth.length ? `<div class="ai-allerg">${esc(enth.join(" · "))}</div>` : ""}
        </div>
        <div class="ai-preise"><span class="mono">${r.teiggewicht ? gramm(r.teiggewicht) : ""}</span></div>
      </button>`;
    }).join("");
  }
  listEl.addEventListener("click", (e) => {
    const b = e.target.closest(".art-item");
    if (b) zeigeDetail(rezepte.find((r) => r.id === b.dataset.id));
  });

  // ---------- Detail ----------
  function zeigeDetail(r) {
    if (!r) return;
    offen = r;
    const d = deklaration(r.id, rezepte, zutaten);
    const enth = ALLERGENE.filter((x) => d.allergene[x.key] === "enthalten");
    const spur = ALLERGENE.filter((x) => d.allergene[x.key] === "spuren");
    const art = artikelVon(r.id);
    const inRez = verwendetIn(r.id);
    f("r-detail-body").innerHTML = `
      <div class="detail-head">
        <div class="m-tint m-tint-orange"><i data-icon="chef-hat"></i></div>
        <div>
          <h3>${esc(r.name)}</h3>
          <div class="li-sub">Rezept · Teiggewicht ${r.teiggewicht ? gramm(r.teiggewicht) : "–"}${r.active === false ? " · inaktiv" : ""}</div>
        </div>
      </div>
      <table class="detail-table rz-tabelle">
        <tbody>
          ${(r.zeilen || []).map((z) => `<tr>
            <td>${z.art === "rezept" ? '<span class="tag-teil">Teilrezept</span> ' : ""}${esc(zeileName(z))}</td>
            <td class="r mono">${zahl(Number(z.menge) || 0)} ${esc(z.art === "rezept" ? "g" : z.einheit)}</td>
          </tr>`).join("") || '<tr><td colspan="2" class="hint-text">Keine Zutaten erfasst.</td></tr>'}
        </tbody>
      </table>
      ${(r.schritte || []).length ? `
      <div class="detail-block">
        <div class="db-title">Arbeitsschritte</div>
        <ol class="schritt-liste">${r.schritte.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      </div>` : ""}
      ${r.notiz ? `<div class="detail-block"><div class="db-title">Bemerkung</div><p class="zutaten-text">${esc(r.notiz)}</p></div>` : ""}
      <div class="detail-block">
        <div class="db-title">Zutatenliste (Deklaration)</div>
        ${d.fehler ? `<p class="error-text" style="margin:0;">${esc(d.fehler)}</p>` : `<p class="zutaten-text">${esc(d.zutaten) || '<span class="hint-text">–</span>'}</p>`}
        ${d.warnungen.map((w) => `<p class="warn-text">${esc(w)}</p>`).join("")}
      </div>
      <div class="detail-block">
        <div class="db-title">Allergene</div>
        ${enth.length ? `<div class="allerg-line"><span class="al-label">Enthält</span><div class="badge-row">${enth.map((x) => `<span class="al-badge al-enth">${esc(x.label)}</span>`).join("")}</div></div>` : ""}
        ${spur.length ? `<div class="allerg-line"><span class="al-label">Kann Spuren enthalten</span><div class="badge-row">${spur.map((x) => `<span class="al-badge al-spur">${esc(x.label)}</span>`).join("")}</div></div>` : ""}
        ${!enth.length && !spur.length ? '<p class="hint-text" style="margin:0;">Keine Allergene.</p>' : ""}
        <div class="hinweis-liste" style="margin-top:10px;">${HINWEISE.map((h) => `<span class="hw ${d.hinweise[h.key] ? "hw-ja" : ""}">${esc(h.label)}: <strong>${d.hinweise[h.key] ? "Ja" : "Nein"}</strong></span>`).join("")}</div>
      </div>
      ${art.length || inRez.length ? `
      <div class="detail-block">
        <div class="db-title">Verwendet in</div>
        ${art.length ? `<p class="zutaten-text">Artikel: ${esc(art.map((a) => a.name).join(", "))}</p>` : ""}
        ${inRez.length ? `<p class="zutaten-text">Rezepte: ${esc(inRez.map((x) => x.name).join(", "))}</p>` : ""}
      </div>` : ""}
      ${r.updatedBy ? `<p class="hint-text" style="margin:14px 0 0;">Zuletzt bearbeitet von ${esc(r.updatedBy)}${r.updatedAt?.toDate ? ` am ${r.updatedAt.toDate().toLocaleDateString("de-CH")}` : ""}</p>` : ""}`;
    openModal("r-detail-modal");
  }
  f("r-detail-close").addEventListener("click", () => closeModal("r-detail-modal"));

  function nachDaten() {
    render();
    if (offen && f("r-detail-modal").classList.contains("active")) {
      const neu = rezepte.find((r) => r.id === offen.id);
      if (neu) zeigeDetail(neu); else closeModal("r-detail-modal");
    }
  }

  const api = {
    setRezepte(list) { rezepte = list; nachDaten(); },
    setZutaten(list) { zutaten = list; nachDaten(); },
    setArtikel(list) { artikel = list; nachDaten(); },
  };
  if (!isAdmin) return api;

  // ---------- Bearbeiten (nur Admin) ----------
  let zeilen = [];   // { art, id, menge (Text), einheit }
  let schritte = []; // Texte

  // Teilrezepte, die gewählt werden dürfen: nicht das Rezept selbst und keines, das dieses Rezept (indirekt) enthält
  function enthaelt(rid, gesucht, besucht = new Set()) {
    if (rid === gesucht) return true;
    if (besucht.has(rid)) return false;
    besucht.add(rid);
    const r = rezepte.find((x) => x.id === rid);
    return (r?.zeilen || []).some((z) => z.art === "rezept" && enthaelt(z.id, gesucht, besucht));
  }
  function auswahlHtml(z) {
    const wert = z.id ? `${z.art}:${z.id}` : "";
    const zut = zutaten.filter((x) => x.active !== false || (z.art === "zutat" && x.id === z.id));
    const rez = rezepte.filter((x) => (x.active !== false || (z.art === "rezept" && x.id === z.id)) &&
      (!bearbeite || !enthaelt(x.id, bearbeite.id)));
    return `<select class="rz-wahl">
      <option value="">Bitte wählen</option>
      <optgroup label="Zutaten">${zut.map((x) => `<option value="zutat:${x.id}" ${wert === `zutat:${x.id}` ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>
      ${rez.length ? `<optgroup label="Teilrezepte">${rez.map((x) => `<option value="rezept:${x.id}" ${wert === `rezept:${x.id}` ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>` : ""}
    </select>`;
  }
  function zeilenRender() {
    f("r-zeilen").innerHTML = zeilen.map((z, i) => `
      <div class="rz-zeile" data-i="${i}">
        ${auswahlHtml(z)}
        <input type="text" class="rz-menge" inputmode="decimal" placeholder="Menge" value="${esc(z.menge)}">
        <select class="rz-einheit" ${z.art === "rezept" ? "disabled" : ""}>
          ${REZEPT_EINHEITEN.map((e) => `<option value="${e}" ${(z.art === "rezept" ? "g" : z.einheit) === e ? "selected" : ""}>${e}</option>`).join("")}
        </select>
        <div class="rz-knoepfe">
          <button type="button" class="icon-btn" data-aktion="hoch" aria-label="Nach oben" ${i === 0 ? "disabled" : ""}><i data-icon="chevron-up" data-size="15"></i></button>
          <button type="button" class="icon-btn" data-aktion="runter" aria-label="Nach unten" ${i === zeilen.length - 1 ? "disabled" : ""}><i data-icon="chevron-down" data-size="15"></i></button>
          <button type="button" class="icon-btn" data-aktion="weg" aria-label="Entfernen"><i data-icon="x" data-size="15"></i></button>
        </div>
      </div>`).join("") || '<p class="hint-text" style="margin:0 0 8px;">Noch keine Zutaten.</p>';
    summeZeigen();
  }
  function summeZeigen() {
    const gueltig = zeilen.filter((z) => z.id && Number(String(z.menge).replace(",", ".")) > 0)
      .map((z) => ({ ...z, menge: Number(String(z.menge).replace(",", ".")) }));
    const s = summe(gueltig);
    f("r-summe").innerHTML = gueltig.length
      ? `Summe der Zutaten: <strong>${zahl(s.g)} g</strong>${s.unvollstaendig ? " (ohne Zutaten in Stk ohne Gewicht pro Stück)" : ""} <button type="button" class="link-btn" id="r-summe-uebernehmen">übernehmen</button>`
      : "";
  }
  f("r-summe").addEventListener("click", (e) => {
    if (e.target.id !== "r-summe-uebernehmen") return;
    const gueltig = zeilen.filter((z) => z.id && Number(String(z.menge).replace(",", ".")) > 0)
      .map((z) => ({ ...z, menge: Number(String(z.menge).replace(",", ".")) }));
    f("r-teiggewicht").value = String(Math.round(summe(gueltig).g));
  });
  f("r-zeilen").addEventListener("input", (e) => {
    const row = e.target.closest(".rz-zeile");
    if (!row) return;
    const z = zeilen[Number(row.dataset.i)];
    if (e.target.matches(".rz-menge")) { z.menge = e.target.value; summeZeigen(); }
    if (e.target.matches(".rz-einheit")) { z.einheit = e.target.value; summeZeigen(); }
    if (e.target.matches(".rz-wahl")) {
      const [art, id] = (e.target.value || ":").split(":");
      z.art = art || "zutat"; z.id = id || "";
      if (z.art === "rezept") z.einheit = "g";
      zeilenRender();
    }
  });
  f("r-zeilen").addEventListener("click", (e) => {
    const b = e.target.closest("[data-aktion]");
    if (!b) return;
    const i = Number(b.closest(".rz-zeile").dataset.i);
    if (b.dataset.aktion === "weg") zeilen.splice(i, 1);
    if (b.dataset.aktion === "hoch" && i > 0) [zeilen[i - 1], zeilen[i]] = [zeilen[i], zeilen[i - 1]];
    if (b.dataset.aktion === "runter" && i < zeilen.length - 1) [zeilen[i + 1], zeilen[i]] = [zeilen[i], zeilen[i + 1]];
    zeilenRender();
  });
  f("r-zeile-neu").addEventListener("click", () => {
    zeilen.push({ art: "zutat", id: "", menge: "", einheit: "g" });
    zeilenRender();
    f("r-zeilen").lastElementChild?.querySelector(".rz-wahl")?.focus();
  });

  function schritteRender() {
    f("r-schritte").innerHTML = schritte.map((s, i) => `
      <div class="rz-schritt" data-i="${i}">
        <span class="rz-nr">${i + 1}.</span>
        <textarea rows="2" maxlength="1000" placeholder="Arbeitsschritt">${esc(s)}</textarea>
        <div class="rz-knoepfe">
          <button type="button" class="icon-btn" data-aktion="hoch" aria-label="Nach oben" ${i === 0 ? "disabled" : ""}><i data-icon="chevron-up" data-size="15"></i></button>
          <button type="button" class="icon-btn" data-aktion="runter" aria-label="Nach unten" ${i === schritte.length - 1 ? "disabled" : ""}><i data-icon="chevron-down" data-size="15"></i></button>
          <button type="button" class="icon-btn" data-aktion="weg" aria-label="Entfernen"><i data-icon="x" data-size="15"></i></button>
        </div>
      </div>`).join("");
  }
  f("r-schritte").addEventListener("input", (e) => {
    const row = e.target.closest(".rz-schritt");
    if (row) schritte[Number(row.dataset.i)] = e.target.value;
  });
  f("r-schritte").addEventListener("click", (e) => {
    const b = e.target.closest("[data-aktion]");
    if (!b) return;
    const i = Number(b.closest(".rz-schritt").dataset.i);
    if (b.dataset.aktion === "weg") schritte.splice(i, 1);
    if (b.dataset.aktion === "hoch" && i > 0) [schritte[i - 1], schritte[i]] = [schritte[i], schritte[i - 1]];
    if (b.dataset.aktion === "runter" && i < schritte.length - 1) [schritte[i + 1], schritte[i]] = [schritte[i], schritte[i + 1]];
    schritteRender();
  });
  f("r-schritt-neu").addEventListener("click", () => {
    schritte.push("");
    schritteRender();
    f("r-schritte").lastElementChild?.querySelector("textarea")?.focus();
  });

  function oeffneFormular(r, kopie = false) {
    bearbeite = kopie ? null : (r || null);
    f("r-edit-title").textContent = kopie ? "Rezept duplizieren" : r ? "Rezept bearbeiten" : "Neues Rezept";
    f("r-edit-error").textContent = "";
    f("r-name").value = r ? (kopie ? `${r.name} (Kopie)` : r.name) : "";
    f("r-teiggewicht").value = r?.teiggewicht ? String(r.teiggewicht) : "";
    f("r-notiz").value = r?.notiz || "";
    zeilen = (r?.zeilen || []).map((z) => ({ art: z.art, id: z.id, menge: String(z.menge).replace(".", ","), einheit: z.einheit || "g" }));
    schritte = [...(r?.schritte || [])];
    zeilenRender();
    schritteRender();
    f("r-edit-extra").style.display = r && !kopie ? "flex" : "none";
    if (r && !kopie) f("r-edit-toggle").textContent = r.active === false ? "Wieder aktivieren" : "Deaktivieren";
    closeModal("r-detail-modal");
    openModal("r-edit-modal");
    if (!r || kopie) setTimeout(() => { f("r-name").focus(); f("r-name").select(); }, 50);
  }
  f("r-neu").addEventListener("click", () => oeffneFormular(null));
  f("r-detail-edit").addEventListener("click", () => oeffneFormular(offen));
  f("r-edit-cancel").addEventListener("click", () => closeModal("r-edit-modal"));
  f("r-edit-duplizieren").addEventListener("click", () => {
    const vorlage = bearbeite;
    if (!vorlage) return;
    closeModal("r-edit-modal");
    oeffneFormular(vorlage, true);
  });

  f("r-edit-save").addEventListener("click", async () => {
    const err = f("r-edit-error");
    err.textContent = "";
    const name = f("r-name").value.trim();
    if (!name) { err.textContent = "Bitte einen Namen eingeben."; return; }
    if (rezepte.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== bearbeite?.id)) {
      err.textContent = "Es gibt bereits ein Rezept mit diesem Namen."; return;
    }
    const tg = Number(f("r-teiggewicht").value.trim().replace(/['’\s]/g, "").replace(",", "."));
    if (!(tg > 0)) { err.textContent = "Bitte das Teiggewicht in Gramm eingeben (Zahl grösser als 0)."; return; }

    const sauber = [];
    for (const z of zeilen) {
      const leer = !z.id && !String(z.menge).trim();
      if (leer) continue;
      if (!z.id) { err.textContent = "Bitte bei jeder Zeile eine Zutat oder ein Teilrezept wählen."; return; }
      const m = Number(String(z.menge).replace(",", "."));
      if (!(m > 0)) { err.textContent = `Bitte bei «${zeileName(z)}» eine Menge grösser als 0 eingeben.`; return; }
      sauber.push({ art: z.art, id: z.id, menge: m, einheit: z.art === "rezept" ? "g" : z.einheit });
    }
    if (!sauber.length) { err.textContent = "Bitte mindestens eine Zutat eingeben."; return; }

    const daten = {
      name,
      teiggewicht: tg,
      zeilen: sauber,
      schritte: schritte.map((s) => s.trim()).filter(Boolean),
      notiz: f("r-notiz").value.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: session.profile.name || "",
    };
    const btn = f("r-edit-save");
    btn.disabled = true;
    try {
      if (bearbeite) await updateDoc(doc(db, "rezepte", bearbeite.id), daten);
      else await addDoc(collection(db, "rezepte"), { ...daten, active: true, createdAt: serverTimestamp() });
      toast(bearbeite ? `«${name}» gespeichert` : `«${name}» angelegt`);
      closeModal("r-edit-modal");
    } catch (e) {
      console.error(e);
      err.textContent = "Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.";
    } finally {
      btn.disabled = false;
    }
  });

  f("r-edit-toggle").addEventListener("click", async () => {
    if (!bearbeite) return;
    const neu = bearbeite.active === false;
    if (!neu && !confirm(`«${bearbeite.name}» deaktivieren? Es kann dann nicht mehr als Teilrezept oder für neue Artikel gewählt werden. Bestehende Verknüpfungen bleiben.`)) return;
    try {
      await updateDoc(doc(db, "rezepte", bearbeite.id), { active: neu, updatedAt: serverTimestamp(), updatedBy: session.profile.name || "" });
      toast(neu ? "Rezept aktiviert" : "Rezept deaktiviert");
      closeModal("r-edit-modal");
    } catch (e) { console.error(e); toast("Ändern fehlgeschlagen"); }
  });

  f("r-edit-delete").addEventListener("click", async () => {
    if (!bearbeite) return;
    const art = artikelVon(bearbeite.id);
    const inRez = verwendetIn(bearbeite.id);
    if (art.length || inRez.length) {
      alert(`«${bearbeite.name}» kann nicht gelöscht werden, weil es noch verwendet wird:\n` +
        (art.length ? `\nArtikel: ${art.map((a) => a.name).join(", ")}` : "") +
        (inRez.length ? `\nRezepte: ${inRez.map((r) => r.name).join(", ")}` : "") +
        "\n\nDu kannst es stattdessen deaktivieren.");
      return;
    }
    if (!confirm(`«${bearbeite.name}» endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    try {
      await deleteDoc(doc(db, "rezepte", bearbeite.id));
      toast("Rezept gelöscht");
      closeModal("r-edit-modal");
    } catch (e) { console.error(e); toast("Löschen fehlgeschlagen"); }
  });

  return api;
}
