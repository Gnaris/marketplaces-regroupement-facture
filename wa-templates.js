// Modèles WhatsApp — partagé entre le modal (content script) et la page Options.
// Les modèles système sont modifiables (la version modifiée est enregistrée
// dans chrome.storage.local.waTemplates.overrides) et peuvent être remis par
// défaut ; les modèles créés par l'utilisateur vivent dans .custom.
// Variables : voir WA_VARIABLES. {boutique} reste accepté comme ancien nom de {company}.
var WA_TEMPLATES_STORAGE_KEY = "waTemplates";

var WA_VARIABLES = [
  { token: "{company}", label: "Nom de votre boutique", hint: "Réglé dans les Options. Vide : « {company} » reste dans le message.", sample: "Beli & Jolie" },
  { token: "{transporteur}", label: "Transporteur", hint: "Choisi au moment de l'envoi (liste rapide ou saisie libre).", sample: "Colissimo" },
  { token: "{adresse}", label: "Adresse de livraison", hint: "Reprise de la commande, modifiable au moment de l'envoi.", sample: "12 rue des Lilas, 69003 Lyon" },
  { token: "{plateforme}", label: "Plateforme de la commande", hint: "Microstore, Faire, Ankorstore… (« notre site » pour la boutique).", sample: "Microstore" },
  { token: "{client}", label: "Société du client", hint: "Nom de la boutique cliente sur la commande.", sample: "Boutique Lumière" },
  { token: "{commande}", label: "N° de commande", hint: "Numéro affiché sur la commande.", sample: "MC-1042" }
];

var WA_DEFAULT_TEMPLATES = [
  { id: "sys-first-link", group: "Première commande", title: "Commande prête — lien de paiement",
    body: "Bonjour, c'est la boutique {company}. Vous avez passé une commande sur {plateforme}, celle-ci est prête. Voici ci-joint la facture de la commande et le lien de paiement. La livraison s'effectuera par {transporteur} à l'adresse : {adresse}. Merci !" },
  { id: "sys-first-transfer", group: "Première commande", title: "Commande prête — virement",
    body: "Bonjour, c'est la boutique {company}. Vous avez passé une commande sur {plateforme}, celle-ci est prête. Voici ci-joint la facture de la commande et le RIB. La livraison s'effectuera par {transporteur} à l'adresse : {adresse}. Merci !" },
  { id: "sys-first-oos-link", group: "Première commande", title: "Rupture de stock — lien de paiement",
    body: "Bonjour, c'est la boutique {company}. Vous avez passé une commande sur {plateforme}, celle-ci est prête. Certains articles sont malheureusement en rupture de stock et ont été retirés de la commande. Voici ci-joint la facture mise à jour et le lien de paiement. La livraison s'effectuera par {transporteur} à l'adresse : {adresse}. Merci !" },
  { id: "sys-first-oos-transfer", group: "Première commande", title: "Rupture de stock — virement",
    body: "Bonjour, c'est la boutique {company}. Vous avez passé une commande sur {plateforme}, celle-ci est prête. Certains articles sont malheureusement en rupture de stock et ont été retirés de la commande. Voici ci-joint la facture mise à jour et le RIB. La livraison s'effectuera par {transporteur} à l'adresse : {adresse}. Merci !" },
  { id: "sys-first-oos-replace", group: "Première commande", title: "Rupture de stock — proposer des remplacements",
    body: "Bonjour, c'est la boutique {company}. Vous avez passé une commande sur {plateforme}, celle-ci est prête. Certains articles sont malheureusement en rupture de stock. Nous pouvons vous proposer des modèles en remplacement, je vous envoie les photos juste après. Dites-moi ce qui vous convient et je vous enverrai la facture. Merci !" },
  { id: "sys-first-pickup", group: "Première commande", title: "Retrait en boutique",
    body: "Bonjour, c'est la boutique {company}. Nous avons bien reçu votre commande passée sur {plateforme} et pris en compte le retrait en boutique. Votre commande est prête, vous pouvez venir la récupérer quand vous le souhaitez. Merci !" },
  { id: "sys-regular-link", group: "Client habitué", title: "Commande prête — lien de paiement",
    body: "Bonjour, j'espère que vous allez bien. Votre commande passée sur {plateforme} est prête. Voici ci-joint la facture de la commande et le lien de paiement. La livraison s'effectuera comme d'habitude par {transporteur} à l'adresse : {adresse}. Merci !" },
  { id: "sys-regular-transfer", group: "Client habitué", title: "Commande prête — virement",
    body: "Bonjour, j'espère que vous allez bien. Votre commande passée sur {plateforme} est prête. Voici ci-joint la facture de la commande et le RIB. La livraison s'effectuera comme d'habitude par {transporteur} à l'adresse : {adresse}. Merci !" },
  { id: "sys-regular-oos-replace", group: "Client habitué", title: "Rupture de stock — proposer des remplacements",
    body: "Bonjour, j'espère que vous allez bien. Votre commande passée sur {plateforme} est prête, mais certains articles sont en rupture de stock. Je vous propose des modèles en remplacement, je vous envoie les photos juste après. Dites-moi ce qui vous convient et je vous enverrai la facture. Merci !" },
  { id: "sys-regular-pickup", group: "Client habitué", title: "Retrait en boutique — commande mise de côté",
    body: "Bonjour, j'espère que vous allez bien. C'est bien noté pour le retrait en boutique : votre commande passée sur {plateforme} est prête et mise de côté. Merci et à bientôt !" }
];

var WA_CUSTOM_GROUP = "Mes modèles";

function waEmptyStore() { return { overrides: {}, custom: [] }; }

function waSanitizeStore(raw) {
  var s = waEmptyStore();
  if (raw && typeof raw === "object") {
    if (raw.overrides && typeof raw.overrides === "object") s.overrides = raw.overrides;
    if (Array.isArray(raw.custom)) s.custom = raw.custom.filter(function (t) { return t && t.id && typeof t.body === "string"; });
  }
  return s;
}

// Liste finale affichée : modèles système (version modifiée si elle existe),
// puis modèles personnalisés. Chaque entrée porte `system` et `modified`.
function waMergeTemplates(store) {
  var s = waSanitizeStore(store);
  var out = WA_DEFAULT_TEMPLATES.map(function (d) {
    var o = s.overrides[d.id];
    return {
      id: d.id,
      system: true,
      modified: !!o,
      group: (o && o.group) || d.group,
      title: (o && o.title) || d.title,
      body: (o && typeof o.body === "string") ? o.body : d.body
    };
  });
  s.custom.forEach(function (c) {
    out.push({ id: c.id, system: false, modified: false, group: c.group || WA_CUSTOM_GROUP, title: c.title || "Sans titre", body: c.body });
  });
  return out;
}

function waLoadStore(cb) {
  try {
    chrome.storage.local.get([WA_TEMPLATES_STORAGE_KEY], function (r) {
      cb(waSanitizeStore(r && r[WA_TEMPLATES_STORAGE_KEY]));
    });
  } catch (e) { cb(waEmptyStore()); }
}

function waSaveStore(store, cb) {
  var o = {};
  o[WA_TEMPLATES_STORAGE_KEY] = waSanitizeStore(store);
  chrome.storage.local.set(o, function () { if (cb) cb(chrome.runtime.lastError || null); });
}

function waDefaultById(id) {
  for (var i = 0; i < WA_DEFAULT_TEMPLATES.length; i++) if (WA_DEFAULT_TEMPLATES[i].id === id) return WA_DEFAULT_TEMPLATES[i];
  return null;
}

function waHasEmoji(text) {
  try { return /\p{Extended_Pictographic}/u.test(String(text || "")); } catch (e) { return false; }
}
