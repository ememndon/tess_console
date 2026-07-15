/* Tess Console — drop-in experience-feedback widget. Self-contained: renders an
 * emoji rating scale (😣🙁😐🙂😍) + an optional comment inside an isolated Shadow
 * DOM and posts the response to /api/collect as a feedback submission. No
 * dependency on t.js. Install one line:
 *   <script defer data-site="resumehub" src="https://<console>/fb.js"></script>
 * Options (all optional):
 *   data-question  prompt text                       (default "How was your experience?")
 *   data-accent    primary color — buttons/underline (default "#6d28d9")
 *   data-accent-2  selection-highlight color         (default = data-accent)
 *   data-mode      "float" | "inline"                (default "float", bottom-right)
 *   data-target    CSS selector to mount into        (overrides mode)
 *   data-theme     "auto" | "light" | "dark"         (default "auto")
 *   data-key       dedup key suffix                  (default the current path)
 *   data-api       ingest URL override               (default <script origin>/api/collect)
 * Rating is sent as "1".."5" (1 = worst). Programmatic open from a SPA:
 *   window.tessFeedback && window.tessFeedback()   // (re)mounts the widget
 */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var site = s.getAttribute("data-site");
  if (!site) return;

  var api = s.getAttribute("data-api") || new URL(s.src).origin + "/api/collect";
  var question = s.getAttribute("data-question") || "How was your experience?";
  var mode = s.getAttribute("data-mode") || "float";
  var target = s.getAttribute("data-target");
  var theme = s.getAttribute("data-theme") || "auto";
  var path = location.pathname;
  var seenKey = "tessfb:" + site + ":" + (s.getAttribute("data-key") || path);

  // Validate colors so they can't break out of the CSS var they're dropped into.
  var COLOR = /^#?[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^(rgb|hsl)a?\([0-9.,%\s]+\)$/;
  var accent = s.getAttribute("data-accent") || "#6d28d9";
  if (!COLOR.test(accent)) accent = "#6d28d9";
  var accent2 = s.getAttribute("data-accent-2") || "";
  if (!COLOR.test(accent2)) accent2 = accent;

  // 1 = worst … 5 = best. Sent as the numeric string.
  var SCALE = [
    { v: "1", e: "😣", l: "Very poor" },
    { v: "2", e: "🙁", l: "Poor" },
    { v: "3", e: "😐", l: "Okay" },
    { v: "4", e: "🙂", l: "Good" },
    { v: "5", e: "😍", l: "Great" },
  ];

  function remember() { try { localStorage.setItem(seenKey, "1"); } catch (e) {} }
  function answered() { try { return !!localStorage.getItem(seenKey); } catch (e) { return false; } }

  function send(rating, message) {
    var p = { site: site, type: "feedback", path: path, rating: rating, message: message || undefined };
    try {
      var body = JSON.stringify(p);
      if (navigator.sendBeacon) navigator.sendBeacon(api, new Blob([body], { type: "text/plain" }));
      else fetch(api, { method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit", headers: { "content-type": "text/plain" } });
    } catch (e) {}
    remember();
  }

  var darkVars = ":host{--bg:#1b1722;--ink:#f3eefb;--mut:#a99fbb;--bd:rgba(255,255,255,.16);--field:#272233}";
  var CSS =
    ":host{all:initial;--bg:#fff;--ink:#241a33;--mut:#6f6480;--bd:rgba(36,26,51,.14);--field:#f5f2f9;--a:" + accent + ";--a2:" + accent2 + ";" +
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}" +
    (theme === "dark" ? darkVars : theme === "light" ? "" : "@media(prefers-color-scheme:dark){" + darkVars + "}") +
    ".card{box-sizing:border-box;width:330px;max-width:90vw;background:var(--bg);color:var(--ink);border:1px solid var(--bd);" +
    "border-radius:18px;padding:18px 20px;box-shadow:0 14px 44px rgba(36,26,51,.16);font-size:14px;line-height:1.45;position:relative;animation:tfin .22s ease}" +
    "@keyframes tfin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}" +
    "@media(prefers-reduced-motion:reduce){.card{animation:none}}" +
    ".q{font-weight:600;margin:0;font-size:15.5px;letter-spacing:-.01em}.q .opt-note{font-weight:400;color:var(--mut)}" +
    ".u{display:block;width:34px;height:3px;border-radius:3px;background:var(--a);margin:8px 0 14px}" +
    ".scale{display:flex;gap:7px}" +
    ".emo{flex:1;border:1.5px solid var(--bd);background:var(--field);border-radius:13px;padding:10px 0;font-size:24px;line-height:1;" +
    "cursor:pointer;transition:transform .12s,border-color .15s,background .15s,box-shadow .15s}" +
    ".emo:hover{transform:translateY(-2px) scale(1.05);border-color:var(--a)}" +
    ".emo:focus-visible{outline:none;border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 30%,transparent)}" +
    ".emo.sel{border-color:var(--a2);background:color-mix(in srgb,var(--a2) 13%,var(--bg));box-shadow:0 0 0 3px color-mix(in srgb,var(--a2) 22%,transparent)}" +
    ".scale-l{display:flex;justify-content:space-between;margin:7px 3px 0;font-size:11px;color:var(--mut)}" +
    "textarea{box-sizing:border-box;width:100%;margin:12px 0 10px;background:var(--field);color:var(--ink);border:1px solid var(--bd);border-radius:11px;padding:10px 12px;font:inherit;resize:vertical;min-height:70px}" +
    "textarea::placeholder{color:var(--mut)}" +
    "textarea:focus{outline:none;border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 22%,transparent)}" +
    "button.send{font:inherit;cursor:pointer;width:100%;border:none;background:var(--a);color:#fff;padding:11px 12px;border-radius:11px;font-weight:600;font-size:14.5px;transition:filter .15s,transform .08s}" +
    "button.send:hover{filter:brightness(1.06)}button.send:active{transform:scale(.99)}" +
    ".x{position:absolute;top:10px;right:12px;width:26px;height:26px;border:none;background:transparent;color:var(--mut);font-size:19px;line-height:1;border-radius:7px;cursor:pointer}" +
    ".x:hover{background:var(--field);color:var(--ink)}" +
    ".done{text-align:center;padding:6px 0}.done .big{font-size:30px;line-height:1}.done .t{font-weight:600;margin:8px 0 0}" +
    ".hidden{display:none}";

  var emojiRow = SCALE.map(function (o) {
    return '<button class="emo" type="button" data-v="' + o.v + '" aria-label="' + o.l + '">' + o.e + "</button>";
  }).join("");

  var HTML =
    '<div class="card" role="group" aria-label="Experience feedback">' +
    '<button class="x" type="button" aria-label="Dismiss">×</button>' +
    '<div class="step ask"><p class="q ask-q"></p><span class="u"></span>' +
    '<div class="scale">' + emojiRow + "</div>" +
    '<div class="scale-l"><span>Very poor</span><span>Great</span></div></div>' +
    '<div class="step cmt hidden"><p class="q cmt-q"></p>' +
    '<textarea maxlength="2000" placeholder="Tell us more…" aria-label="Additional comments"></textarea>' +
    '<button class="send" type="button">Send feedback</button></div>' +
    '<div class="step done hidden"><div class="big">🙏</div><p class="t">Thanks for your feedback!</p></div>' +
    "</div>";

  function init() {
    if (answered()) return; // already answered/dismissed on this key
    if (window.__tessFbMounted && mode !== "inline" && !target) return; // one floating widget per page
    var host = document.createElement("div");
    host.setAttribute("data-tess-feedback", "");
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = document.createElement("style");
    style.textContent = CSS;
    var box = document.createElement("div");
    box.innerHTML = HTML;
    root.appendChild(style);
    root.appendChild(box);

    var q = root.querySelector(".ask-q");
    if (q) q.textContent = question; // textContent — never inject owner text as HTML
    var xBtn = root.querySelector(".x");

    // Mount: explicit target → floating bottom-right → inline at the tag.
    if (target) {
      var mt = document.querySelector(target);
      if (!mt) return;
      mt.appendChild(host);
    } else if (mode === "inline") {
      host.style.cssText = "display:block;margin:14px 0";
      if (s.parentNode) s.parentNode.insertBefore(host, s.nextSibling);
      else document.body.appendChild(host);
    } else {
      host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483646";
      document.body.appendChild(host);
      window.__tessFbMounted = true;
    }
    if ((mode === "inline" || target) && xBtn) xBtn.classList.add("hidden");

    function show(name) {
      ["ask", "cmt", "done"].forEach(function (k) {
        var el = root.querySelector(".step." + k);
        if (el) el.classList[k === name ? "remove" : "add"]("hidden");
      });
    }
    function finish() {
      show("done");
      if (mode !== "inline" && !target) setTimeout(function () { host.remove(); window.__tessFbMounted = false; }, 2600);
    }

    var picked = "";
    root.querySelectorAll(".emo").forEach(function (btn) {
      btn.addEventListener("click", function () {
        picked = btn.getAttribute("data-v") || "";
        root.querySelectorAll(".emo").forEach(function (b) { b.classList.remove("sel"); });
        btn.classList.add("sel");
        var cq = root.querySelector(".cmt-q");
        if (cq) {
          cq.innerHTML = ""; // reset
          var lead = picked <= "2" ? "Sorry to hear that — what went wrong?" : picked === "3" ? "Thanks! Anything we could improve?" : "Glad to hear it! Anything you'd like to add?";
          cq.appendChild(document.createTextNode(lead + " "));
          var note = document.createElement("span");
          note.className = "opt-note";
          note.textContent = "(optional)";
          cq.appendChild(note);
        }
        show("cmt");
        var ta = root.querySelector("textarea");
        if (ta) ta.focus();
      });
    });

    root.querySelector(".send").addEventListener("click", function () {
      if (!picked) return;
      var ta = root.querySelector("textarea");
      send(picked, ta && ta.value.trim());
      finish();
    });
    if (xBtn) xBtn.addEventListener("click", function () { remember(); host.remove(); window.__tessFbMounted = false; });
  }

  // Expose a manual (re)mount for single-page apps — call when the resume is ready.
  window.tessFeedback = init;

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", init);
  else init();
})();
