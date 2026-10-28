import { requireSession, logout } from "./session.js";
import { db } from "./firebase-config.js";
import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initZutaten } from "./zutaten.js";
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
    },
    (err) => { console.error(err); toast("Zutaten konnten nicht geladen werden."); }
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
