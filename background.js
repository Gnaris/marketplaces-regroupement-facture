const SHOPIFY_QUERY = `query OrderRegroup($id: ID!) {
  order(id: $id) {
    name
    subtotalPriceSet { shopMoney { amount currencyCode } }
    totalPriceSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    billingAddressMatchesShippingAddress
    shippingAddress {
      name firstName lastName company
      address1 address2 city zip
      provinceCode countryCodeV2 country
      phone
    }
    billingAddress {
      name firstName lastName company
      address1 address2 city zip
      provinceCode countryCodeV2 country
      phone
    }
    lineItems(first: 250) {
      edges {
        node {
          title
          quantity
          currentQuantity
          variantTitle
          sku
          image { url }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
}`;

const EFP_QUERY = `query GetOrderDetail($id: Int!) {
  commandeById(id: $id) {
    id_commande
    id_commande_name
    montantApresRemise
    acheteur {
      nomContact
      prenomContact
      email
      nomSociete
      tva_intra
      eori
    }
    adresseFacturation {
      adresse
      codePostal
      ville
      telephone
      mobile
      NomContact
      Societe
      pays {
        texte_fr
      }
    }
    lignes {
      prixLigne
      quantite_total
      corbeille
      categorie
      reference
      reference_base
      couleur_FR
      imageUrl
    }
  }
}`;

const lastMcOrders = new Map();

chrome.tabs && chrome.tabs.onRemoved && chrome.tabs.onRemoved.addListener(function (tabId) {
  lastMcOrders.delete(tabId);
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return;

  if (message.type === "SAVE_MC_ORDER") {
    if (sender.tab && sender.tab.id != null && message.data) {
      lastMcOrders.set(sender.tab.id, message.data);
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "GET_MC_ORDER") {
    const tabId = sender.tab && sender.tab.id;
    const data = tabId != null ? lastMcOrders.get(tabId) : null;
    sendResponse({ ok: !!data, data: data || null });
    return;
  }

  if (message.type === "SAGE_BRIDGE_CREATE") {
    // Création directe d'une facture provisoire dans Sage 50 via SageBridge
    // (programme Windows local, http://127.0.0.1:8765 — voir CLAUDE.md).
    // Fetch depuis le service worker : l'origine est déclarée dans
    // host_permissions, donc pas de CORS ni de Private Network Access.
    sageBridgeCreate(message.payload || {})
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, unreachable: true, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "SAGE_LOOKUP_REFS") {
    const refs = Array.isArray(message.refs) ? message.refs.slice(0, 60) : [];
    Promise.all(
      refs.map(function (ref) {
        return lookupBjRef(String(ref));
      })
    )
      .then(function (results) {
        const out = {};
        refs.forEach(function (ref, i) {
          if (results[i]) out[ref] = results[i];
        });
        sendResponse({ ok: true, data: out });
      })
      .catch(function (err) {
        sendResponse({ ok: false, error: (err && err.message) || String(err) });
      });
    return true;
  }

  if (message.type === "ANNUAIRE_LOOKUP") {
    annuaireLookup(message.query, message.kind)
      .then(function (data) { sendResponse({ ok: true, data: data }); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "VIES_LOOKUP") {
    viesLookup(message.query)
      .then(function (data) { sendResponse({ ok: true, data: data }); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "EE_RATES") {
    easyExpressRates(message.payload || {})
      .then(function (data) { sendResponse({ ok: true, data: data }); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "EE_CHECKOUT") {
    easyExpressCheckout(message.payload || {})
      .then(function (data) { sendResponse({ ok: true, data: data }); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "EE_VALIDATE_KEY") {
    easyExpressValidateKey(String(message.token || ""))
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "OPEN_EE_FROM_ORDER") {
    openEasyExpressFromOrder(message.payload || {})
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type !== "FETCH_ORDER") return;

  const site = message.site;
  const orderId = message.orderId;
  const token = message.token;

  if (site === "pfs") {
    if (!orderId || !token) {
      sendResponse({ ok: false, error: "Paramètres manquants (orderId / token)." });
      return;
    }
    const url = "https://wholesaler-api.parisfashionshops.com/api/v1/orders/" + orderId;
    fetch(url, {
      method: "GET",
      headers: {
        Authorization: token,
        Accept: "application/json, text/plain, */*"
      }
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "efp") {
    const idNum = parseInt(orderId, 10);
    if (!idNum) {
      sendResponse({ ok: false, error: "ID commande invalide." });
      return;
    }
    const body = JSON.stringify({
      query: EFP_QUERY,
      variables: { id: idNum }
    });
    fetch("https://wapi.efashion-paris.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*"
      },
      body: body,
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "aks") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    const apiBase = message.apiBase || "https://fr.ankorstore.com";
    const headers = {
      Accept: "application/vnd.api+json, application/json, */*",
      "X-Requested-With": "XMLHttpRequest"
    };
    const itemsUrl =
      apiBase +
      "/api/internal/v1/ordering/orders/" +
      encodeURIComponent(orderId) +
      "/order-items?include=orderedProduct";
    const detailUrl =
      apiBase +
      "/api/internal/v1/ordering/orders/" +
      encodeURIComponent(orderId);
    Promise.all([
      fetch(itemsUrl, { method: "GET", headers: headers, credentials: "include" }),
      fetch(detailUrl, { method: "GET", headers: headers, credentials: "include" })
    ])
      .then(function (responses) {
        const itemsResp = responses[0];
        const detailResp = responses[1];
        if (!itemsResp.ok) {
          return itemsResp.text().then(function (body) {
            sendResponse({
              ok: false,
              error: "Erreur API items (" + itemsResp.status + " " + itemsResp.statusText + ")",
              body: body && body.slice ? body.slice(0, 300) : ""
            });
          });
        }
        return Promise.all([
          itemsResp.json(),
          detailResp.ok ? detailResp.json().catch(function () { return null; }) : null
        ]).then(function (parsed) {
          sendResponse({ ok: true, data: { items: parsed[0], detail: parsed[1] } });
        });
      })
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "faire") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    const url =
      "https://www.faire.com/api/brand-order/" +
      encodeURIComponent(orderId) +
      "/details";
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, */*"
      },
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "shopify") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    const storeName = message.storeName;
    const csrfToken = message.csrfToken;
    if (!storeName) {
      sendResponse({ ok: false, error: "Nom de boutique Shopify manquant." });
      return;
    }
    if (!csrfToken) {
      sendResponse({
        ok: false,
        error:
          "Jeton CSRF Shopify introuvable. Rechargez la page (F5) et recliquez sur le bouton."
      });
      return;
    }
    const url =
      "https://admin.shopify.com/api/shopify/" +
      encodeURIComponent(storeName) +
      "?operation=OrderRegroup";
    const body = JSON.stringify({
      query: SHOPIFY_QUERY,
      operationName: "OrderRegroup",
      operationType: "query",
      variables: { id: "gid://shopify/Order/" + orderId }
    });
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
        "Shopify-Proxy-Api-Enable": "true",
        "Apollographql-Client-Name": "core"
      },
      body: body,
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "bj" || site === "issyma") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    // Beli & Jolie et Issyma partagent la même app Next.js multi-tenant :
    // même endpoint, même contrat, apiBase (location.origin) sélectionne
    // simplement le domaine — le middleware côté serveur résout le tenant
    // par le host de la requête.
    const defaultBase = site === "issyma" ? "https://issyma.fr" : "https://beliandjolie.com";
    const apiBase = message.apiBase || defaultBase;
    const url =
      apiBase +
      "/api/admin/commandes/" +
      encodeURIComponent(orderId) +
      "/regroup";
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, */*"
      },
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  sendResponse({ ok: false, error: "Site inconnu : " + site });
});

// ---- Résolution catégorie via l'API publique Beli & Jolie ----
// GET /api/public/products avec le header x-product-reference renvoie le
// produit (catégorie + images). Les SKU marketplace de la forme
// {REFERENCE}_{COULEUR} (Ankorstore, etc.) sont retentés avec la partie
// avant le premier « _ » si la référence complète est introuvable.
const BJ_PUBLIC_API = "https://beliandjolie.com/api/public/products";
const BJ_PUBLIC_API_KEY = "kebab";

function fetchBjProduct(reference) {
  return fetch(BJ_PUBLIC_API, {
    method: "GET",
    headers: {
      "x-api-key": BJ_PUBLIC_API_KEY,
      "x-product-reference": reference,
      Accept: "application/json"
    }
  })
    .then(function (resp) {
      return resp.ok ? resp.json() : null;
    })
    .catch(function () {
      return null;
    });
}

function shapeBjLookup(p) {
  let image = null;
  if (Array.isArray(p.colors)) {
    for (const c of p.colors) {
      if (c && Array.isArray(c.imageUrls) && c.imageUrls.length) {
        image = c.imageUrls[0];
        break;
      }
    }
  }
  return { category: p.category || null, name: p.name || null, image: image };
}

function lookupBjRef(ref) {
  const trimmed = ref.trim();
  if (!trimmed) return Promise.resolve(null);
  return fetchBjProduct(trimmed).then(function (json) {
    if (json && json.product) return shapeBjLookup(json.product);
    const base = trimmed.split("_")[0].trim();
    if (!base || base === trimmed) return null;
    return fetchBjProduct(base).then(function (j2) {
      return j2 && j2.product ? shapeBjLookup(j2.product) : null;
    });
  });
}

function handleResponse(sendResponse) {
  return function (resp) {
    if (!resp.ok) {
      return resp.text().then(function (body) {
        sendResponse({
          ok: false,
          error: "Erreur API (" + resp.status + " " + resp.statusText + ")",
          body: body && body.slice ? body.slice(0, 300) : ""
        });
      });
    }
    return resp.json().then(function (data) {
      sendResponse({ ok: true, data: data });
    });
  };
}

function handleError(sendResponse) {
  return function (err) {
    sendResponse({ ok: false, error: (err && err.message) || String(err) });
  };
}

// ---- Annuaire des Entreprises (recherche-entreprises.api.gouv.fr) ----
// API publique INSEE/DINUM, pas de clé, CORS ouvert. On interroge via le
// service worker pour éviter toute collision avec la CSP de la page hôte.
// `kind` = "siret" (14 chiffres) | "siren" (9 chiffres). On ne renvoie au
// content script qu'une forme normalisée (siren, siret siège, dénomination,
// adresse, état admin, activité, TVA recalculée).
function annuaireLookup(query, kind) {
  const q = String(query || "").replace(/\D/g, "");
  if (kind === "siret" && q.length !== 14) {
    return Promise.resolve({ found: false, reason: "SIRET invalide (14 chiffres attendus)." });
  }
  if (kind === "siren" && q.length !== 9) {
    return Promise.resolve({ found: false, reason: "SIREN invalide (9 chiffres attendus)." });
  }
  const url =
    "https://recherche-entreprises.api.gouv.fr/search?q=" +
    encodeURIComponent(q) +
    "&page=1&per_page=5";
  return fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  })
    .then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (body) {
          throw new Error("Annuaire : " + resp.status + " " + resp.statusText + (body ? " — " + body.slice(0, 200) : ""));
        });
      }
      return resp.json();
    })
    .then(function (json) {
      const results = (json && json.results) || [];
      if (!results.length) return { found: false };
      // Si la requête est un SIRET, on cherche l'établissement correspondant
      // dans matching_etablissements ; sinon on prend le siège.
      const unite = results[0];
      let etab = unite.siege || null;
      if (kind === "siret" && Array.isArray(unite.matching_etablissements)) {
        const match = unite.matching_etablissements.find(function (e) {
          return e && String(e.siret || "").replace(/\D/g, "") === q;
        });
        if (match) etab = match;
      }
      const siren = String(unite.siren || "").replace(/\D/g, "");
      const siretOut = etab ? String(etab.siret || "").replace(/\D/g, "") : "";
      const adresseLigne = etab
        ? [etab.adresse || etab.libelle_commune ? etab.adresse : null, etab.libelle_commune].filter(Boolean).join(", ")
        : "";
      const denomination =
        unite.nom_complet || unite.nom_raison_sociale || unite.sigle || "";
      const etat = (etab && etab.etat_administratif) || unite.etat_administratif || null;
      return {
        found: true,
        siren: siren,
        siret: siretOut,
        denomination: denomination,
        adresse: etab ? etab.adresse || "" : "",
        codePostal: etab ? etab.code_postal || "" : "",
        commune: etab ? etab.libelle_commune || etab.commune || "" : "",
        adresseLigne: adresseLigne,
        etatAdministratif: etat,
        activiteCode: unite.activite_principale || null,
        activiteLibelle: unite.libelle_activite_principale || null,
        tva: siren ? tvaFromSiren(siren) : null
      };
    });
}

function tvaFromSiren(siren) {
  if (!/^\d{9}$/.test(siren)) return null;
  const n = parseInt(siren, 10);
  const key = ((12 + 3 * (n % 97)) % 97).toString().padStart(2, "0");
  return "FR" + key + siren;
}

// ---- VIES (vérification TVA UE hors FR) ----
// VIES REST officiel : https://ec.europa.eu/taxation_customs/vies/rest-api/
// Codes pays acceptés par VIES : les 27 EM + XI (Irlande du Nord). La Grèce
// est "EL" dans VIES (jamais "GR") — on tolère "GR" en entrée et on convertit.
// Les parties numériques varient par pays (NL/SE/HU peuvent contenir des
// lettres), d'où la regex permissive sur le corps.
const EU_VAT_COUNTRIES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU",
  "IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"
]);

function parseEuVat(raw) {
  const cleaned = String(raw || "").replace(/[\s\-.]/g, "").toUpperCase();
  if (cleaned.length < 4) return null;
  let country = cleaned.slice(0, 2);
  if (country === "GR") country = "EL";
  if (!EU_VAT_COUNTRIES.has(country)) return null;
  const number = cleaned.slice(2);
  if (!/^[0-9A-Z+*]{2,13}$/.test(number)) return null;
  return { country: country, number: number };
}

// Appelle VIES. Réponse officielle (vérifiée sur l'endpoint REST) :
//   { isValid, requestDate, userError, name, address, requestIdentifier, ... }
// VIES renvoie "---" pour name/address quand l'État membre refuse la
// divulgation (DE, ES notamment). On normalise ces valeurs à "".
function viesLookup(rawVat) {
  const parsed = parseEuVat(rawVat);
  if (!parsed) {
    return Promise.resolve({ found: false, source: "VIES", reason: "N° TVA UE invalide (préfixe pays + chiffres attendus)." });
  }
  const url =
    "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/" +
    encodeURIComponent(parsed.country) +
    "/vat/" + encodeURIComponent(parsed.number);
  return fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  })
    .then(function (resp) {
      return resp.json().catch(function () { return null; }).then(function (json) {
        if (!resp.ok) {
          const code = (json && (json.userError || json.message)) || resp.status + " " + resp.statusText;
          throw new Error("VIES : " + code);
        }
        return json;
      });
    })
    .then(function (json) {
      if (!json) return { found: false, source: "VIES", reason: "Réponse VIES vide." };
      const isValid = json.isValid === true || json.valid === true;
      const rawName = String(json.name || json.traderName || "").trim();
      const rawAddr = String(json.address || json.traderAddress || "").trim();
      const name = rawName === "---" ? "" : rawName;
      const address = rawAddr === "---" ? "" : rawAddr;
      const countryOut = parsed.country === "EL" ? "GR" : parsed.country;
      return {
        found: isValid,
        source: "VIES",
        valid: isValid,
        country: countryOut,
        tva: parsed.country + parsed.number,
        denomination: name,
        adresseLigne: address,
        requestDate: json.requestDate || null,
        userError: json.userError || null,
        reason: isValid ? "" : "N° TVA non valide selon VIES."
      };
    });
}

// ─────────────────────────────────────────────
// Easy-Express v3 — cotation + création bordereau
// Doc : https://easy-express.fr/storage/file/download/v3.html
// Flux : POST /rates (transactionId + carriers) → POST /checkout (tracking + PDF)
// ─────────────────────────────────────────────

const EE_BASE_URL = "https://easy-express.fr";
const EE_MAX_PARCEL_WEIGHT_KG = 25;

function eeSplitParcels(totalKg) {
  const total = Math.max(1, Number(totalKg) || 1);
  if (total <= EE_MAX_PARCEL_WEIGHT_KG) return [{ weight: total }];
  const parcels = [];
  let remaining = total;
  while (remaining > EE_MAX_PARCEL_WEIGHT_KG) {
    parcels.push({ weight: EE_MAX_PARCEL_WEIGHT_KG });
    remaining -= EE_MAX_PARCEL_WEIGHT_KG;
  }
  parcels.push({ weight: Math.max(1, Math.round(remaining * 100) / 100) });
  return parcels;
}

const EE_COUNTRY_MAP = {
  france: "FR", belgique: "BE", suisse: "CH", luxembourg: "LU",
  allemagne: "DE", espagne: "ES", italie: "IT", "pays-bas": "NL",
  portugal: "PT", "royaume-uni": "GB", "royaume uni": "GB",
  "etats-unis": "US", "etats unis": "US", canada: "CA",
  irlande: "IE", autriche: "AT", danemark: "DK", suede: "SE",
  norvege: "NO", finlande: "FI", pologne: "PL", "republique tcheque": "CZ",
  grece: "GR", hongrie: "HU", roumanie: "RO", bulgarie: "BG",
  slovaquie: "SK", slovenie: "SI", croatie: "HR", estonie: "EE",
  lettonie: "LV", lituanie: "LT", malte: "MT", chypre: "CY"
};

function eeCountryToCode(country) {
  if (!country) return "FR";
  const trimmed = String(country).trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const normalized = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return EE_COUNTRY_MAP[normalized] || "FR";
}

function eeGetSettings() {
  return new Promise(function (resolve) {
    chrome.storage.sync.get(["easyExpressToken", "easyExpressSender"], function (res) {
      resolve({
        token: res.easyExpressToken || "",
        sender: res.easyExpressSender || null
      });
    });
  });
}

function eeHeaders(token) {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": "Bearer " + token
  };
}

// Convertit une réponse "centimes" en euros avec arrondi à 2 décimales.
function eeCentsToEuros(v) {
  const n = Number(v) || 0;
  return Math.round(n) / 100;
}

// Détecte défensivement un éventuel champ discount/promo renvoyé par Easy-Express.
// La doc officielle ne liste que price + priceIncTax, mais au cas où le fournisseur
// enrichirait la réponse plus tard, on cherche quelques noms courants.
function eeExtractDiscount(carrier, infos) {
  const candidates = [
    carrier.discount, carrier.promo, carrier.promotion, carrier.reduction,
    carrier.originalPrice, carrier.basePrice, carrier.publicPrice,
    infos && infos.discount, infos && infos.promo, infos && infos.reduction,
    infos && infos.originalPrice, infos && infos.basePrice, infos && infos.publicPrice
  ];
  for (const c of candidates) {
    if (c != null && c !== 0 && c !== "") return c;
  }
  return null;
}

// Idem pour un éventuel champ assurance (prix TTC avec assurance intégrée).
// Pas documenté par Easy-Express v3 ; on affiche uniquement si l'API renvoie
// réellement un montant supérieur au TTC nu — zéro calcul côté extension.
function eeExtractInsuranceTTC(carrier, infos) {
  const candidates = [
    carrier.priceWithInsurance, carrier.priceInsurance, carrier.insurancePrice,
    carrier.priceIncTaxWithInsurance, carrier.priceTTCInsurance,
    infos && infos.priceWithInsurance, infos && infos.priceInsurance, infos && infos.insurancePrice
  ];
  for (const c of candidates) {
    if (c != null && c !== 0 && c !== "") return c;
  }
  return null;
}

async function easyExpressRates(payload) {
  const settings = await eeGetSettings();
  if (!settings.token) {
    return { success: false, error: "Clé API Easy-Express non configurée. Ouvrez les options de l'extension." };
  }
  if (!settings.sender || !settings.sender.postalCode) {
    return { success: false, error: "Adresse expéditeur incomplète. Ouvrez les options de l'extension." };
  }

  const body = {
    senderAddress: {
      countryCode: eeCountryToCode(settings.sender.country),
      postalCode: settings.sender.postalCode
    },
    receiverAddress: {
      countryCode: eeCountryToCode(payload.receiverCountry),
      postalCode: payload.receiverZipCode || ""
    },
    parcels: eeSplitParcels(payload.weightKg)
  };

  const res = await fetch(EE_BASE_URL + "/api/v3/shipments/rates", {
    method: "POST",
    headers: eeHeaders(settings.token),
    body: JSON.stringify(body),
    cache: "no-store"
  });

  const text = await res.text();
  if (!res.ok) {
    return { success: false, error: "Easy-Express rates (" + res.status + ") : " + text.slice(0, 200) };
  }

  let data;
  try { data = JSON.parse(text); }
  catch { return { success: false, error: "Easy-Express rates : réponse non-JSON." }; }

  const response = data.Response || {};
  if (response.Code !== 200) {
    const msg = typeof response.Message === "string" ? response.Message : "Erreur inconnue.";
    return { success: false, error: "Easy-Express rates : " + msg };
  }

  const message = response.Message || {};
  const transactionId = String(message.transactionId || "");
  const rawCarriers = Array.isArray(message.carriers) ? message.carriers : [];
  const parcelCount = eeSplitParcels(payload.weightKg).length;

  const carriers = rawCarriers.map(function (c) {
    const infos = c.infos || {};
    const priceHT = eeCentsToEuros(c.price);
    // Si l'API ne fournit pas priceIncTax, on recalcule à 20 % TVA par défaut.
    const priceTTC = c.priceIncTax != null
      ? eeCentsToEuros(c.priceIncTax)
      : Math.round(priceHT * 1.2 * 100) / 100;

    const discount = eeExtractDiscount(c, infos);
    const discountHT = discount != null
      ? (typeof discount === "number" && discount > 100 ? eeCentsToEuros(discount) : Number(discount) || 0)
      : null;

    const rawInsurance = eeExtractInsuranceTTC(c, infos);
    const priceTTCWithInsurance = rawInsurance != null
      ? (typeof rawInsurance === "number" && rawInsurance > 100 ? eeCentsToEuros(rawInsurance) : Number(rawInsurance) || null)
      : null;

    return {
      carrierId: String(c.id || ""),
      code: String(c.code || ""),
      name: String(c.name || ""),
      logo: String(c.logo || ""),
      priceHT: priceHT,
      priceTTC: priceTTC,
      priceTTCWithInsurance: priceTTCWithInsurance,
      discountHT: discountHT,
      delay: String(infos.estimatedArrival || "3-5 jours"),
      maxSize: String(infos.maximumSizeSupported || ""),
      storage: String(infos.storageLocation || "")
    };
  });

  return {
    success: true,
    transactionId: transactionId,
    carriers: carriers,
    parcelCount: parcelCount
  };
}

async function easyExpressCheckout(payload) {
  const settings = await eeGetSettings();
  if (!settings.token) {
    return { success: false, error: "Clé API Easy-Express non configurée." };
  }
  if (!settings.sender) {
    return { success: false, error: "Adresse expéditeur non configurée." };
  }

  const sender = settings.sender;
  const r = payload.receiver || {};
  const weightKg = Number(payload.weightKg) || 1;

  const body = {
    transactionId: payload.transactionId,
    carrierId: payload.carrierId,
    shipmentRequest: {
      parcels: eeSplitParcels(weightKg),
      senderAddress: {
        company: sender.company || "",
        shopName: sender.shopName || sender.company || "",
        email: sender.email || "",
        phoneNumber: sender.phone || "",
        mobileNumber: sender.phone || "",
        street: sender.street || "",
        complement: sender.complement || "",
        city: sender.city || "",
        postalCode: sender.postalCode || "",
        countryCode: eeCountryToCode(sender.country),
        siret: sender.siret || ""
      },
      receiverAddress: {
        firstName: r.firstName || "",
        lastName: r.lastName || "",
        company: r.company || "",
        shopName: "",
        email: r.email || "",
        phoneNumber: r.phone || "",
        mobileNumber: r.phone || "",
        street: r.street || "",
        complement: r.complement || "",
        city: r.city || "",
        stateProvinceCode: "",
        postalCode: r.postalCode || "",
        countryCode: eeCountryToCode(r.country),
        instructions: r.instructions || ""
      }
    }
  };

  const res = await fetch(EE_BASE_URL + "/api/v3/shipments/checkout", {
    method: "POST",
    headers: eeHeaders(settings.token),
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    return { success: false, error: "Easy-Express checkout (" + res.status + ") : " + text.slice(0, 200) };
  }

  let data;
  try { data = JSON.parse(text); }
  catch { return { success: false, error: "Easy-Express checkout : réponse non-JSON." }; }

  const response = data.Response || {};
  if (response.Code !== 200) {
    const msg = typeof response.Message === "string" ? response.Message : "Erreur inconnue.";
    return { success: false, error: "Easy-Express checkout : " + msg };
  }

  const message = response.Message || {};
  const parcels = Array.isArray(message.parcels) ? message.parcels : [];
  const first = parcels[0] || {};
  const trackingId = String(first.tracking || "");
  const labelUrl = String(message.labels || first.ticket || "");

  if (!labelUrl) {
    return { success: false, error: "Easy-Express : URL du bordereau absente de la réponse." };
  }

  return {
    success: true,
    trackingId: trackingId,
    labelUrl: labelUrl,
    parcels: parcels
  };
}

// ─────────────────────────────────────────────
// Ouverture du popup pré-rempli depuis une commande marketplace.
// Appelé par content.js après extraction de l'adresse de livraison.
// On stocke le prefill dans chrome.storage.local puis on ouvre popup.html
// en fenêtre standalone (chrome.windows.create) — un content script ne peut
// pas déclencher chrome.action.openPopup() directement.
// ─────────────────────────────────────────────
async function openEasyExpressFromOrder(payload) {
  const prefill = {
    receiver: payload && payload.receiver ? payload.receiver : {},
    orderNo: (payload && payload.orderNo) || "",
    source: (payload && payload.source) || "order",
    timestamp: Date.now()
  };
  await new Promise(function (resolve) {
    chrome.storage.local.set({ eePrefill: prefill }, function () { resolve(); });
  });
  await new Promise(function (resolve, reject) {
    chrome.windows.create(
      {
        url: chrome.runtime.getURL("popup.html?from=order"),
        type: "popup",
        width: 460,
        height: 760,
        focused: true
      },
      function (win) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(win);
      }
    );
  });
  return { ok: true };
}

async function easyExpressValidateKey(token) {
  if (!token) return { ok: false, error: "Jeton vide." };
  // Easy-Express n'expose pas d'endpoint /me documenté : on fait une cotation
  // minimale (FR → FR, 1 kg) qui sert de ping. 401/403 = jeton invalide.
  try {
    const res = await fetch(EE_BASE_URL + "/api/v3/shipments/rates", {
      method: "POST",
      headers: eeHeaders(token),
      body: JSON.stringify({
        senderAddress: { countryCode: "FR", postalCode: "75001" },
        receiverAddress: { countryCode: "FR", postalCode: "75002" },
        parcels: [{ weight: 1 }]
      })
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Jeton refusé par Easy-Express (401/403)." };
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    const code = data && data.Response && data.Response.Code;
    if (code === 200) return { ok: true };
    // 200 HTTP + code applicatif non-200 : jeton accepté mais payload refusé — on
    // considère que le jeton est valide (c'est l'adresse qui coince, pas lui).
    if (res.ok) return { ok: true };
    return { ok: false, error: "Ping Easy-Express (" + res.status + ")." };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}


// ─── SageBridge (création directe dans Sage 50) ───────────────────────────
const SAGE_BRIDGE_URL = "http://127.0.0.1:8765";

async function sageBridgeCreate(payload) {
  const controller = new AbortController();
  // SageBridge borne chaque opération Sage à 2 minutes : on attend un peu plus.
  const timer = setTimeout(function () { controller.abort(); }, 150000);
  let response;
  try {
    response = await fetch(SAGE_BRIDGE_URL + "/facture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    // Délai dépassé : la facture a peut-être été créée quand même (ne pas parler de « SageBridge absent »).
    if (err && err.name === "AbortError") return { ok: false, timeout: true, error: "Délai dépassé" };
    // Connexion refusée = SageBridge pas lancé (ou port changé).
    return { ok: false, unreachable: true, error: (err && err.message) || String(err) };
  }
  clearTimeout(timer);
  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }
  if (!data) return { ok: false, error: "Réponse illisible de SageBridge (HTTP " + response.status + ")." };
  data.status = response.status;
  return data;
}
