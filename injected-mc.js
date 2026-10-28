(function () {
  if (window.__mcRegroupInjected) return;
  window.__mcRegroupInjected = true;

  const RX = /\/pluginsWeb\/orderInfo\//;

  function post(data) {
    window.postMessage({ source: "mc-regroup", type: "MC_ORDER", data: data }, "*");
  }

  // La réponse orderInfo ne contient ni la ville de facturation ni le carnet
  // d'adresses du client : on complète avec la fiche client
  // (`customer/get?id=…`), appelée avec la même clé de session que orderInfo.
  // Résultat joint sous `data.__mcCustomer`. En cas d'échec, la commande est
  // envoyée telle quelle.
  function enrichAndSend(url, data) {
    if (!data) return;
    let clientId = null;
    let key = null;
    let base = null;
    try {
      const di = data.data && data.data.doc_info;
      clientId = di && (di.client_id || (di.client_info && di.client_info.client_id));
      const u = new URL(url, location.href);
      key = u.searchParams.get("key");
      base = u.origin + u.pathname.replace(/\/pluginsWeb\/orderInfo\/.*$/, "");
    } catch (e) {}
    if (!clientId || clientId === "0" || !key || !base) {
      post(data);
      return;
    }
    const q = new URLSearchParams({ id: String(clientId), lang: "fr", key: key });
    const timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 8000); });
    const req = originalFetch(base + "/customer/get?" + q.toString())
      .then(function (r) { return r.json(); })
      .then(function (j) { return j && String(j.err) === "0" && j.info ? j.info : null; })
      .catch(function () { return null; });
    Promise.race([req, timeout]).then(function (info) {
      if (info) data.__mcCustomer = info;
      post(data);
    });
  }

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const result = originalFetch.apply(this, arguments);
    if (url && RX.test(url)) {
      result
        .then(function (resp) {
          return resp.clone().json();
        })
        .then(function (json) { enrichAndSend(url, json); })
        .catch(function () {});
    }
    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mcUrl = url;
    if (typeof url === "string" && RX.test(url)) {
      const xhr = this;
      this.addEventListener("load", function () {
        try {
          enrichAndSend(url, JSON.parse(xhr.responseText));
        } catch (e) {}
      });
    }
    return originalOpen.apply(this, arguments);
  };
})();
