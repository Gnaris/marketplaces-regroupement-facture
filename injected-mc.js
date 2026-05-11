(function () {
  if (window.__mcRegroupInjected) return;
  window.__mcRegroupInjected = true;

  const RX = /\/pluginsWeb\/orderInfo\//;

  function send(data) {
    if (!data) return;
    window.postMessage({ source: "mc-regroup", type: "MC_ORDER", data: data }, "*");
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
        .then(send)
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
          send(JSON.parse(xhr.responseText));
        } catch (e) {}
      });
    }
    return originalOpen.apply(this, arguments);
  };
})();
