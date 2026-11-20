import { requireSession, logout } from "./session.js";
import { db } from "./firebase-config.js";
import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initZutaten } from "./zutaten.js";
import { initRezepte } from "./rezepte.js";
import { initKategorien } from "./kategorien.js";
import { artikelAbgleich } from "./rezeptberechnung.js";
import { initLieferanten } from "./lieferanten.js";
import { toast } from "./ui.js";

// Zugriff: admin = alles, backstube = nur lesen (ohne Einkaufspreise), andere Konten = kein Zugriff
async function start() {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return; // requireSession hat bereits umgeleitet
  }

  const { profile } = session;
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("user-name-label").textContent = profile.name || "";

  if (!["admin", "backstube"].includes(profile.role)) {
    document.querySelector("main").innerHTML =
      '<div class="card form-card" style="margin-top:24px;"><h3 class="section-title">Kein Zugriff</h3>' +
      '<p class="hint-text">Die Rezepte sind nur für den Admin und die Backstube freigegeben.</p></div>';
    document.getElementById("nav-wrap").style.display = "none";
    return;
  }

  const isAdmin = profile.role === "admin";
  document.body.classList.toggle("is-admin", isAdmin);
  setupNav();

  const zutaten = initZutaten(session);
  const lieferanten = initLieferanten(session);
  const rezepte = initRezepte(session);
  const kategorien = initKategorien(session);

  // Kategorien der Zutaten live laden
  onSnapshot(
    collection(db, "zutatKategorien"),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      kategorien.setKategorien(list);
      zutaten.setKategorien(list);
      rezepte.setKategorien(list);
    },
    (err) => { console.error(err); toast("Kategorien konnten nicht geladen werden."); }
  );

  // Für den Abgleich der Artikel (Zutatenliste/Allergene aus dem Rezept)
  const daten = { rezepte: null, zutaten: null, artikel: null };
  const abgleich = artikelAbgleich(daten, isAdmin, profile.name || "");

  // Lieferanten live laden (für die Liste und die Auswahl bei den Zutaten)
  onSnapshot(
    query(collection(db, "lieferanten"), orderBy("name")),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      zutaten.setLieferanten(list);
      lieferanten.setLieferanten(list);
    },
    (err) => { console.error(err); toast("Lieferanten konnten nicht geladen werden."); }
  );

  // Zutaten live laden
  onSnapshot(
    query(collection(db, "zutaten"), orderBy("name")),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      zutaten.setZutaten(list);
      lieferanten.setZutaten(list);
      rezepte.setZutaten(list);
      kategorien.setZutaten(list);
      daten.zutaten = list; abgleich();
    },
    (err) => { console.error(err); toast("Zutaten konnten nicht geladen werden."); }
  );

  // Rezepte live laden
  onSnapshot(
    query(collection(db, "rezepte"), orderBy("name")),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rezepte.setRezepte(list);
      zutaten.setRezepte(list);
      daten.rezepte = list; abgleich();
    },
    (err) => { console.error(err); toast("Rezepte konnten nicht geladen werden."); }
  );

  // Artikel (für «Verwendet in» und den Abgleich)
  onSnapshot(
    collection(db, "artikel"),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rezepte.setArtikel(list);
      daten.artikel = list; abgleich();
    },
    (err) => { console.error(err); }
  );

  // Einkaufspreise liegen getrennt und sind nur für den Admin lesbar
  if (isAdmin) {
    onSnapshot(
      collection(db, "zutatenPreise"),
      (snap) => {
        const preise = {};
        snap.docs.forEach((d) => { preise[d.id] = d.data(); });
        zutaten.setPreise(preise);
      },
      (err) => { console.error(err); toast("Preise konnten nicht geladen werden."); }
    );
  }

  document.querySelectorAll(".modal-backdrop").forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("active"); })
  );
}

function setupNav() {
  const buttons = document.querySelectorAll("#main-nav button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      window.scrollTo(0, 0);
    });
  });
}

start();
