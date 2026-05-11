(function () {
  if (window.__pfsRegroupInjected) return;
  window.__pfsRegroupInjected = true;

  function sendToken(token) {
    if (!token) return;
    window.postMessage({ source: "pfs-regroup", type: "AUTH_TOKEN", token: token }, "*");
  }

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && url.indexOf("wholesaler-api.parisfashionshops.com") !== -1) {
        let auth = null;
        if (init && init.headers) {
          if (init.headers instanceof Headers) {
            auth = init.headers.get("Authorization") || init.headers.get("authorization");
          } else if (typeof init.headers === "object") {
            auth = init.headers.Authorization || init.headers.authorization;
          }
        }
        if (!auth && input instanceof Request) {
          auth = input.headers.get("Authorization");
        }
        sendToken(auth);
      }
    } catch (e) {}
    return originalFetch.apply(this, arguments);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__pfsUrl = url;
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (
      typeof name === "string" &&
      name.toLowerCase() === "authorization" &&
      this.__pfsUrl &&
      String(this.__pfsUrl).indexOf("wholesaler-api.parisfashionshops.com") !== -1
    ) {
      sendToken(value);
    }
    return originalSetHeader.apply(this, arguments);
  };
})();
