// Content script sur https://www.smarty365.com/dashboard/* (application Vue,
// navigation sans rechargement). Injecte injected-smarty.js dans le page world
// (accès aux composants Vue / au store Vuex de la page) sur toutes les pages
// du tableau de bord :
//   - toujours : sur la liste des transporteurs d'un envoi de colis, la case
//     « Assurance » est cochée par défaut sur chaque transporteur ;
//   - si l'onglet a été ouvert par Transporteurs ▾ → Smarty365 du modal, le
//     service worker garde le destinataire et la valeur de la commande pour
//     cet onglet : on les passe au script de page, qui sélectionne ou crée le
//     destinataire puis remplit la valeur à assurer.
(function () {
  "use strict";
  if (window.top !== window.self) return;

  let prefill = null;

  function ask() {
    try {
      chrome.runtime.sendMessage({ type: "S365_GET_PREFILL" }, function (res) {
        if (!chrome.runtime.lastError && res && res.ok && res.data) prefill = res.data;
        inject();
      });
    } catch (e) { /* extension rechargée : rien à faire */ }
  }

  function inject() {
    window.addEventListener("message", function (ev) {
      if (ev.source !== window || !ev.data || ev.data.source !== "s365-regroup") return;
      if (ev.data.type === "S365_READY") {
        window.postMessage({ source: "s365-regroup-ext", type: "S365_PREFILL", data: prefill }, location.origin);
      } else if (ev.data.type === "S365_ADDRESS_DONE") {
        if (prefill) prefill.addressDone = true;
        try { chrome.runtime.sendMessage({ type: "S365_ADDRESS_DONE" }); } catch (e) { /* ignore */ }
      } else if (ev.data.type === "S365_DONE") {
        try { chrome.runtime.sendMessage({ type: "S365_PREFILL_DONE" }); } catch (e) { /* ignore */ }
      }
    });
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected-smarty.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  }

  ask();
})();
