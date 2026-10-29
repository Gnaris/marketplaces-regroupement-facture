// Content script sur https://easy-express.fr/shipping*.
// Si cet onglet a été ouvert par le bouton « Afficher la liste des transporteurs
// sur Easy Express » du modal, le service worker garde le destinataire de la
// commande pour cet onglet : on le récupère et on le passe à injected-ee.js
// (page world, accès à appObj — l'application Vue de la page).
(function () {
  "use strict";
  if (window.top !== window.self) return;

  let prefill = null;

  function ask() {
    try {
      chrome.runtime.sendMessage({ type: "EE_GET_PREFILL" }, function (res) {
        if (chrome.runtime.lastError || !res || !res.ok || !res.data) return;
        prefill = res.data;
        inject();
      });
    } catch (e) { /* extension rechargée : rien à faire */ }
  }

  function inject() {
    window.addEventListener("message", function (ev) {
      if (ev.source !== window || !ev.data || ev.data.source !== "ee-regroup") return;
      if (ev.data.type === "EE_READY" && prefill) {
        window.postMessage({ source: "ee-regroup-ext", type: "EE_PREFILL", data: prefill }, location.origin);
      } else if (ev.data.type === "EE_DONE") {
        try { chrome.runtime.sendMessage({ type: "EE_PREFILL_DONE" }); } catch (e) { /* ignore */ }
      }
    });
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected-ee.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  }

  ask();
})();
