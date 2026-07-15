/* Tess Console — first-party analytics tracker. Cookieless,
 * privacy-friendly. Install one line per site:
 *   <script defer data-site="calculatry" src="https://<console>/t.js"></script>
 * Flags: data-404 (mark a 404 page) · data-spa (track client-side route changes).
 * Custom events:  tess('calc_used', { calculator: 'bmi' })
 * Feedback:       tess.feedback('helpful', 'optional message')
 */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var site = s.getAttribute("data-site");
  if (!site) return;
  var api = s.getAttribute("data-api") || new URL(s.src).origin + "/api/collect";
  var is404 = s.hasAttribute("data-404");
  var spa = s.hasAttribute("data-spa");
  var errBudget = 10; // cap error reports per page so a loop can't flood ingestion

  function send(p) {
    p.site = site;
    try {
      var body = JSON.stringify(p);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(api, new Blob([body], { type: "text/plain" }));
      } else {
        fetch(api, {
          method: "POST",
          body: body,
          keepalive: true,
          mode: "cors",
          credentials: "omit",
          headers: { "content-type": "text/plain" },
        });
      }
    } catch (e) {}
  }

  function qp(n) {
    try {
      return new URLSearchParams(location.search).get(n) || undefined;
    } catch (e) {
      return undefined;
    }
  }

  function pageview() {
    var load;
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && nav.duration) load = Math.round(nav.duration);
      else if (performance.timing) {
        var t = performance.timing;
        if (t.loadEventEnd && t.navigationStart) load = t.loadEventEnd - t.navigationStart;
      }
    } catch (e) {}
    send({
      type: is404 ? "not_found" : "pageview",
      path: location.pathname,
      ref: document.referrer || undefined,
      utm_source: qp("utm_source"),
      utm_medium: qp("utm_medium"),
      utm_campaign: qp("utm_campaign"),
      load: load,
    });
  }

  // Public API ----------------------------------------------------------------
  var tess = function (name, props) {
    send({ type: "event", name: name, path: location.pathname, props: props || {} });
  };
  tess.event = tess;
  tess.pageview = pageview;
  tess.feedback = function (rating, message) {
    send({ type: "feedback", path: location.pathname, rating: rating, message: message });
  };
  window.tess = tess;

  // Error + unhandled-rejection capture ---------------------------------------
  addEventListener("error", function (e) {
    if (errBudget-- <= 0) return;
    send({
      type: "error",
      path: location.pathname,
      props: {
        message: String((e && e.message) || "Error").slice(0, 300),
        source: String((e && e.filename) || "").slice(0, 300),
        line: (e && e.lineno) || 0,
        col: (e && e.colno) || 0,
      },
    });
  });
  addEventListener("unhandledrejection", function (e) {
    if (errBudget-- <= 0) return;
    var r = e && e.reason;
    send({
      type: "error",
      path: location.pathname,
      props: { message: ("Unhandled rejection: " + ((r && (r.message || r)) || "")).slice(0, 300), kind: "promise" },
    });
  });

  // SPA route changes (opt-in) -------------------------------------------------
  if (spa && history.pushState) {
    var fire = function () {
      setTimeout(pageview, 0);
    };
    var wrap = function (m) {
      var orig = history[m];
      history[m] = function () {
        var r = orig.apply(this, arguments);
        fire();
        return r;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    addEventListener("popstate", fire);
  }

  // First hit ------------------------------------------------------------------
  if (document.readyState === "complete") pageview();
  else addEventListener("load", pageview);
})();
