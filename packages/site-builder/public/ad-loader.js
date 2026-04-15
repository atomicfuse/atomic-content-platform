/**
 * Atomic Network — runtime ad loader.
 *
 * Fetches the per-domain monetization JSON from the platform CDN and
 * dynamically injects ad slot containers, head/body scripts, and the
 * interstitial overlay. Build-time HTML stays generic — only this script
 * knows about ad placements, sizes, and provider SDKs.
 *
 * Cache strategy: the latest CDN response is mirrored to localStorage so
 * a CDN failure on a subsequent navigation falls back to the previous
 * configuration instead of breaking monetization entirely.
 */
(async function () {
  var d = location.hostname;
  var cdnBase =
    (window.__ATL_CDN_BASE__ ||
      document.documentElement.getAttribute('data-atl-cdn') ||
      'https://cdn.atomicnetwork.com');
  var c = null;

  try {
    var r = await fetch(cdnBase + '/m/' + d + '.json', { credentials: 'omit' });
    if (r.ok) {
      c = await r.json();
      try {
        localStorage.setItem('_atl_m', JSON.stringify(c));
      } catch (e) {}
    }
  } catch (e) {}

  if (!c) {
    try {
      c = JSON.parse(localStorage.getItem('_atl_m'));
    } catch (e) {}
  }
  if (!c) return;

  var scripts = c.scripts || {};
  var ads = c.ads_config || {};

  // Load head scripts (ad network SDKs)
  (scripts.head || []).forEach(function (s) {
    var el = document.createElement('script');
    if (s.src) {
      el.src = s.src;
      if (s.async !== false) el.async = true;
    } else if (s.inline) {
      el.textContent = s.inline;
    } else {
      return;
    }
    document.head.appendChild(el);
  });

  // Inject ad containers
  (ads.ad_placements || []).forEach(function (p) {
    var slot = makeSlot(p);
    if (p.position === 'above-content') {
      var anchor = document.querySelector('[data-slot="above-content"]');
      if (anchor) attachToSlot(anchor, slot);
    } else if (p.position && p.position.indexOf('after-paragraph-') === 0) {
      var n = parseInt(p.position.split('-').pop(), 10);
      var ph = document.querySelector('[data-after-p="' + n + '"]');
      if (ph) {
        ph.style.display = '';
        ph.innerHTML = '';
        ph.appendChild(slot);
      } else {
        var para = document.querySelector('[data-p-index="' + n + '"]');
        if (para && para.parentNode) para.parentNode.insertBefore(slot, para.nextSibling);
      }
    } else if (p.position === 'sidebar') {
      var sb = document.querySelector('[data-slot="sidebar"]');
      if (sb) sb.appendChild(slot);
    } else if (p.position === 'sticky-bottom') {
      var st = document.querySelector('[data-slot="sticky-bottom"]');
      if (st) attachToSlot(st, slot);
    } else if (p.position === 'below-content') {
      var bc = document.querySelector('[data-slot="below-content"]');
      if (bc) bc.appendChild(slot);
    }
  });

  // Load body_end scripts
  (scripts.body_end || []).forEach(function (s) {
    var el = document.createElement('script');
    if (s.src) {
      el.src = s.src;
      if (s.async !== false) el.async = true;
    } else if (s.inline) {
      el.textContent = s.inline;
    } else {
      return;
    }
    document.body.appendChild(el);
  });

  // Interstitial
  if (ads.interstitial) initInterstitial();

  function attachToSlot(anchor, slot) {
    anchor.innerHTML = '';
    anchor.appendChild(slot);
    anchor.style.display = '';
  }

  function makeSlot(p) {
    var sizes = p.sizes || {};
    var div = document.createElement('div');
    div.id = 'ad-' + p.id;
    div.className =
      'ad-slot' +
      (p.device === 'desktop' ? ' atl-hidden-mobile' : '') +
      (p.device === 'mobile' ? ' atl-hidden-desktop' : '');
    div.dataset.adId = p.id;
    div.dataset.sizesDesktop = JSON.stringify(sizes.desktop || []);
    div.dataset.sizesMobile = JSON.stringify(sizes.mobile || []);
    var first = (sizes.desktop && sizes.desktop[0]) || (sizes.mobile && sizes.mobile[0]) || [300, 250];
    div.style.minWidth = first[0] + 'px';
    div.style.minHeight = first[1] + 'px';
    div.style.margin = '1rem auto';
    div.style.textAlign = 'center';
    var label = document.createElement('span');
    label.className = 'ad-label';
    label.textContent = 'Advertisement';
    label.style.cssText =
      'display:block;font-size:0.625rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-bottom:0.25rem;';
    div.appendChild(label);
    return div;
  }

  function initInterstitial() {
    if (sessionStorage.getItem('_atl_int')) return;
    setTimeout(function () {
      var overlay = document.createElement('div');
      overlay.id = 'atl-interstitial';
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
      var container = document.createElement('div');
      container.style.cssText =
        'background:#fff;border-radius:12px;padding:20px;max-width:400px;width:90%;position:relative;';
      container.dataset.adId = 'interstitial';
      var close = document.createElement('button');
      close.textContent = 'Close';
      close.style.cssText =
        'position:absolute;top:8px;right:12px;background:none;border:none;font-size:14px;cursor:pointer;color:#666;';
      close.onclick = function () {
        overlay.remove();
        sessionStorage.setItem('_atl_int', '1');
      };
      container.appendChild(close);
      overlay.appendChild(container);
      document.body.appendChild(overlay);
    }, 3000);
  }
})();
