/* Tess Console — widget-embed tracker. Ships inside
 * Calculatry's embeddable widgets; pings home with the embedding host so the
 * console builds a live registry of sites running the widget (backlink program).
 *   <script defer data-site="calculatry" src="https://<console>/w.js"></script>
 */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var site = s.getAttribute("data-site") || "calculatry";
  var api = s.getAttribute("data-api") || new URL(s.src).origin + "/api/collect";
  try {
    var body = JSON.stringify({
      site: site,
      type: "embed",
      host: location.hostname.replace(/^www\./, ""),
      path: location.pathname,
    });
    if (navigator.sendBeacon) navigator.sendBeacon(api, new Blob([body], { type: "text/plain" }));
    else
      fetch(api, {
        method: "POST",
        body: body,
        keepalive: true,
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "text/plain" },
      });
  } catch (e) {}
})();
