(function () {
  const primary = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  const fallback = "https://unpkg.com/@supabase/supabase-js@2";
  document.addEventListener("error", function (event) {
    const script = event.target;
    if (!(script instanceof HTMLScriptElement)) return;
    if (script.src !== primary || script.dataset.fallbackLoaded === "true") return;
    script.dataset.fallbackLoaded = "true";
    script.src = fallback;
  }, true);
})();
