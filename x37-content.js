// Content script sur https://www.37-express.com/*.
// Si cet onglet a été ouvert par le bouton « Afficher la liste des
// transporteurs sur 37 Express » du modal, le service worker garde le
// destinataire de la commande pour cet onglet : on le récupère et on le passe
// à injected-37.js (page world, accès à Parcel / Alpine de la page) qui
// sélectionne ou crée le destinataire dans le carnet d'adresses 37 Express,
// puis, à l'étape « Assurance », saisit la valeur de la commande.
(function () {
  "use strict";
  if (window.top !== window.self) return;

  let prefill = null;

  function ask() {
    try {
      chrome.runtime.sendMessage({ type: "X37_GET_PREFILL" }, function (res) {
        if (chrome.runtime.lastError || !res || !res.ok || !res.data) return;
        // Étape « Adresses » (champ Destinataire), tant que le destinataire
        // n'a pas été choisi ; étape « Assurance » pour la valeur à assurer.
        // Ailleurs (connexion, colis…) on garde les données pour plus tard.
        const onAddress = !!document.getElementById("shipping_address_id");
        const onInsurance = !!document.getElementById("parcel-insurance-form");
        if (onAddress && res.data.addressDone) return;
        if (!onAddress && !onInsurance) return;
        prefill = res.data;
        inject();
      });
    } catch (e) { /* extension rechargée : rien à faire */ }
  }

  function inject() {
    window.addEventListener("message", function (ev) {
      if (ev.source !== window || !ev.data || ev.data.source !== "x37-regroup") return;
      if (ev.data.type === "X37_READY" && prefill) {
        window.postMessage({ source: "x37-regroup-ext", type: "X37_PREFILL", data: prefill }, location.origin);
      } else if (ev.data.type === "X37_ADDRESS_DONE") {
        // Destinataire choisi : on garde la valeur du colis pour l'assurance.
        try { chrome.runtime.sendMessage({ type: "X37_ADDRESS_DONE" }); } catch (e) { /* ignore */ }
      } else if (ev.data.type === "X37_DONE") {
        try { chrome.runtime.sendMessage({ type: "X37_PREFILL_DONE" }); } catch (e) { /* ignore */ }
      }
    });
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected-37.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  }

  ask();
})();
