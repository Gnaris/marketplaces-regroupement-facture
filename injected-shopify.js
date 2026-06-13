(function () {
  if (window.__shopifyRegroupInjected) return;
  window.__shopifyRegroupInjected = true;

  function send(token) {
    if (!token) return;
    try {
      window.postMessage(
        { source: "shopify-regroup", type: "CSRF_TOKEN", token: String(token) },
        "*"
      );
    } catch (e) {}
  }

  function isShopifyApi(url) {
    try {
      const u = String(url || "");
      if (u.indexOf("admin.shopify.com/api/") !== -1) return true;
      if (u.charAt(0) === "/" && u.indexOf("/api/") === 0) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function extractTokenFromHeaders(headers) {
    if (!headers) return null;
    try {
      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        return headers.get("X-CSRF-Token") || headers.get("x-csrf-token");
      }
      if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (pair && pair[0] && String(pair[0]).toLowerCase() === "x-csrf-token") {
            return pair[1];
          }
        }
        return null;
      }
      if (typeof headers === "object") {
        for (const k in headers) {
          if (k.toLowerCase() === "x-csrf-token") return headers[k];
        }
      }
    } catch (e) {}
    return null;
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      try {
        let url = "";
        if (typeof input === "string") url = input;
        else if (input && input.url) url = input.url;
        if (isShopifyApi(url)) {
          let token = null;
          if (init && init.headers) token = extractTokenFromHeaders(init.headers);
          if (!token && input && input.headers) token = extractTokenFromHeaders(input.headers);
          if (token) send(token);
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__shopifyUrl = url; } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (name && String(name).toLowerCase() === "x-csrf-token" && isShopifyApi(this.__shopifyUrl)) {
        send(value);
      }
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };
})();
