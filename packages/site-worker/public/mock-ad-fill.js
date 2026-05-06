/**
 * mock-ad-fill.js — Drop-in ad simulation for demos and QA
 * 
 * This script runs AFTER ad-loader.js creates the ad containers.
 * It finds all elements with data-ad-id and fills them with
 * realistic-looking placeholder ads.
 * 
 * HOW TO USE:
 * Add this script tag AFTER ad-loader.js in your page:
 *   <script src="https://cdn.atomicnetwork.com/mock-ad-fill.js" defer></script>
 * 
 * Or for local testing, place in site-builder/public/ and reference:
 *   <script src="/mock-ad-fill.js" defer></script>
 * 
 * REMOVE THIS SCRIPT before going live with real ad partners.
 */

(function() {
  'use strict';

  // Wait for ad-loader.js to finish creating containers
  const CHECK_INTERVAL = 200;
  const MAX_WAIT = 5000;
  let waited = 0;

  const MOCK_ADS = {
    'top-banner': {
      label: 'TOP BANNER',
      color: '#1a73e8',
      bg: '#e8f0fe',
      mockBrand: 'TechGadget Pro X',
      mockCta: 'Shop Now →'
    },
    'in-content-1': {
      label: 'IN-CONTENT #1',
      color: '#e65100',
      bg: '#fff3e0',
      mockBrand: 'CloudHost Premium',
      mockCta: 'Start Free Trial'
    },
    'in-content-2': {
      label: 'IN-CONTENT #2',
      color: '#2e7d32',
      bg: '#e8f5e9',
      mockBrand: 'LearnCode Academy',
      mockCta: 'Enroll Today'
    },
    'in-content-3': {
      label: 'IN-CONTENT #3',
      color: '#6a1b9a',
      bg: '#f3e5f5',
      mockBrand: 'FitTrack Watch',
      mockCta: 'Get 30% Off'
    },
    'sidebar-sticky': {
      label: 'SIDEBAR',
      color: '#c62828',
      bg: '#ffebee',
      mockBrand: 'Premium Hosting\n99.9% Uptime\nFrom $3.99/mo',
      mockCta: 'Compare Plans'
    },
    'mobile-anchor': {
      label: 'MOBILE ANCHOR',
      color: '#00695c',
      bg: '#e0f2f1',
      mockBrand: 'Download Our App',
      mockCta: 'Install Free'
    },
    // Homepage / category placements
    'homepage-top-banner': {
      label: 'HOMEPAGE TOP',
      color: '#1565C0',
      bg: '#E3F2FD',
      mockBrand: 'Featured Sponsor',
      mockCta: 'Visit Site →'
    },
    'category-banner': {
      label: 'CATEGORY TOP',
      color: '#00838F',
      bg: '#E0F7FA',
      mockBrand: 'Category Sponsor',
      mockCta: 'Discover More'
    },
    'homepage-mid': {
      label: 'HOMEPAGE MID',
      color: '#283593',
      bg: '#E8EAF6',
      mockBrand: 'Mid-Page Feature',
      mockCta: 'Learn More'
    },
    'taboola-below': {
      label: 'SPONSORED CONTENT',
      color: '#37474f',
      bg: '#eceff1',
      mockBrand: '',
      mockCta: ''
    },
    // mock-minimal group placements (purple/magenta palette)
    'mini-top': {
      label: 'GROUP: MINI TOP',
      color: '#7B1FA2',
      bg: '#F3E5F5',
      mockBrand: 'GroupAd Demo',
      mockCta: 'Learn More'
    },
    'mini-mid': {
      label: 'GROUP: MINI MID',
      color: '#AD1457',
      bg: '#FCE4EC',
      mockBrand: 'GroupAd Content',
      mockCta: 'Read More'
    }
  };

  // Generic fallback for unknown placement ids
  var DEFAULT_MOCK = {
    label: 'AD PLACEMENT',
    color: '#546e7a',
    bg: '#eceff1',
    mockBrand: 'Advertiser',
    mockCta: 'Learn More'
  };

  function fillSlot(el) {
    var adId = el.dataset.adId || el.id.replace('ad-', '');
    var mock = MOCK_ADS[adId] || DEFAULT_MOCK;
    var sizesDesktop = [];
    var sizesMobile = [];
    
    try { sizesDesktop = JSON.parse(el.dataset.sizesDesktop || '[]'); } catch(e) {}
    try { sizesMobile = JSON.parse(el.dataset.sizesMobile || '[]'); } catch(e) {}
    
    var isMobile = window.innerWidth < 768;
    var sizes = isMobile ? sizesMobile : sizesDesktop;
    var size = (sizes && sizes[0]) || [300, 250];
    var w = size[0];
    var h = size[1];

    // Clear existing content (like the "Advertisement" label)
    el.innerHTML = '';

    // Create the mock ad
    var ad = document.createElement('div');
    ad.style.cssText = [
      'box-sizing: border-box',
      'width: 100%',
      w > 0 ? ('max-width: ' + w + 'px') : '',
      h > 0 ? ('height: ' + h + 'px') : 'height: auto',
      'background: ' + mock.bg,
      'border: 2px dashed ' + mock.color,
      'border-radius: 8px',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'justify-content: center',
      'margin: 0 auto',
      'position: relative',
      'overflow: hidden',
      'font-family: -apple-system, BlinkMacSystemFont, sans-serif',
      'cursor: pointer',
      'transition: transform 0.15s ease, box-shadow 0.15s ease'
    ].join(';');

    // Hover effect
    ad.onmouseenter = function() { 
      ad.style.transform = 'scale(1.01)'; 
      ad.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; 
    };
    ad.onmouseleave = function() { 
      ad.style.transform = 'scale(1)'; 
      ad.style.boxShadow = 'none'; 
    };

    // "AD" badge top-left
    var badge = document.createElement('div');
    badge.style.cssText = [
      'position: absolute',
      'top: 4px',
      'left: 6px',
      'font-size: 9px',
      'font-weight: 600',
      'color: ' + mock.color,
      'opacity: 0.6',
      'letter-spacing: 0.5px'
    ].join(';');
    badge.textContent = 'AD';
    ad.appendChild(badge);

    // Size label top-right
    var sizeLabel = document.createElement('div');
    sizeLabel.style.cssText = [
      'position: absolute',
      'top: 4px',
      'right: 6px',
      'font-size: 9px',
      'color: ' + mock.color,
      'opacity: 0.5',
      'font-family: monospace'
    ].join(';');
    sizeLabel.textContent = w + '×' + h;
    ad.appendChild(sizeLabel);

    // Placement type label
    var typeLabel = document.createElement('div');
    typeLabel.style.cssText = [
      'font-size: 10px',
      'font-weight: 600',
      'color: ' + mock.color,
      'opacity: 0.4',
      'letter-spacing: 1px',
      'margin-bottom: 6px'
    ].join(';');
    typeLabel.textContent = mock.label;
    ad.appendChild(typeLabel);

    // Mock brand name
    if (mock.mockBrand) {
      var brand = document.createElement('div');
      brand.style.cssText = [
        'font-size: ' + (h > 100 ? '16px' : '13px'),
        'font-weight: 700',
        'color: ' + mock.color,
        'text-align: center',
        'padding: 0 12px',
        'white-space: pre-line',
        'line-height: 1.3'
      ].join(';');
      brand.textContent = mock.mockBrand;
      ad.appendChild(brand);
    }

    // Taboola-style grid for below-content
    if (adId === 'taboola-below' || adId.includes('taboola')) {
      ad.style.flexDirection = 'column';
      ad.style.alignItems = 'stretch';
      ad.style.padding = '12px';

      var title = document.createElement('div');
      title.style.cssText = 'font-size:11px;color:#666;margin-bottom:8px;font-weight:600;';
      title.textContent = 'Sponsored Content — You May Also Like';
      ad.appendChild(title);

      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;flex:1;';

      var taboolaItems = [
        { title: '15 Best Budget Travel Destinations', source: 'TravelMag' },
        { title: 'The New Electric Car Everyone Is Talking About', source: 'AutoReview' },
        { title: 'Doctors Stunned By Simple Memory Trick', source: 'HealthDaily' }
      ];

      taboolaItems.forEach(function(item) {
        var card = document.createElement('div');
        card.style.cssText = 'background:#f5f5f5;border-radius:4px;padding:8px;display:flex;flex-direction:column;justify-content:space-between;';
        
        var thumb = document.createElement('div');
        thumb.style.cssText = 'width:100%;height:60px;background:#ddd;border-radius:3px;margin-bottom:6px;';
        card.appendChild(thumb);

        var t = document.createElement('div');
        t.style.cssText = 'font-size:11px;font-weight:600;color:#333;line-height:1.2;margin-bottom:4px;';
        t.textContent = item.title;
        card.appendChild(t);

        var s = document.createElement('div');
        s.style.cssText = 'font-size:9px;color:#999;';
        s.textContent = item.source;
        card.appendChild(s);

        grid.appendChild(card);
      });
      ad.appendChild(grid);
    }

    // CTA button (for non-taboola ads)
    if (mock.mockCta && !adId.includes('taboola')) {
      var cta = document.createElement('div');
      cta.style.cssText = [
        'margin-top: 8px',
        'padding: 6px 16px',
        'background: ' + mock.color,
        'color: white',
        'border-radius: 4px',
        'font-size: ' + (h > 100 ? '13px' : '11px'),
        'font-weight: 600'
      ].join(';');
      cta.textContent = mock.mockCta;
      ad.appendChild(cta);
    }

    // Slot ID at bottom
    var idLabel = document.createElement('div');
    idLabel.style.cssText = [
      'position: absolute',
      'bottom: 3px',
      'left: 0',
      'right: 0',
      'text-align: center',
      'font-size: 8px',
      'font-family: monospace',
      'color: ' + mock.color,
      'opacity: 0.35'
    ].join(';');
    idLabel.textContent = 'slot: ' + adId;
    ad.appendChild(idLabel);

    el.appendChild(ad);
    el.style.display = '';
  }

  function fillAll() {
    var slots = document.querySelectorAll('[data-ad-id]');
    if (slots.length === 0) {
      waited += CHECK_INTERVAL;
      if (waited < MAX_WAIT) {
        setTimeout(fillAll, CHECK_INTERVAL);
        return;
      }
    }
    slots.forEach(fillSlot);
    
    // Also fill any data-slot containers that ad-loader might have populated
    document.querySelectorAll('[data-slot]').forEach(function(slot) {
      if (slot.querySelector('[data-ad-id]')) return; // already has an ad
      // Leave empty — this slot wasn't targeted by any placement
    });

    addDebugPanel();
  }

  function addDebugPanel() {
    var panel = document.createElement('div');
    panel.id = 'atl-ad-debug';
    panel.style.cssText = [
      'position: fixed',
      'bottom: 60px',
      'right: 12px',
      'background: rgba(0,0,0,0.85)',
      'color: #fff',
      'padding: 12px 16px',
      'border-radius: 8px',
      'font-family: monospace',
      'font-size: 11px',
      'z-index: 10000',
      'max-width: 280px',
      'line-height: 1.5',
      'backdrop-filter: blur(8px)',
      'box-shadow: 0 4px 20px rgba(0,0,0,0.3)',
      'cursor: move'
    ].join(';');

    var slots = document.querySelectorAll('[data-ad-id]');
    var config = null;
    try { config = JSON.parse(localStorage.getItem('_atl_m')); } catch(e) {}

    var lines = [];
    lines.push('<div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#ffd54f;">🟡 Mock Ads Active</div>');
    
    if (config) {
      lines.push('<div style="color:#81c784;">Groups: ' + (config.groups ? config.groups.join(', ') : 'unknown') + '</div>');
      if (config.applied_overrides && config.applied_overrides.length > 0) {
        lines.push('<div style="color:#ffd54f;font-weight:700;">Override active: ' + config.applied_overrides.join(', ') + '</div>');
      } else {
        lines.push('<div style="color:#ce93d8;font-weight:700;">Group config only (no override)</div>');
      }
      lines.push('<div style="color:#90caf9;">Placements: ' + (config.ads_config?.ad_placements?.length || 0) + '</div>');
      lines.push('<div style="color:#ce93d8;">Scripts: ' + ((config.scripts?.head?.length || 0) + (config.scripts?.body_end?.length || 0)) + '</div>');
      if (config.tracking?.ga4) lines.push('<div style="color:#a5d6a7;">GA4: ' + config.tracking.ga4 + '</div>');
      if (config.tracking?.gtm) lines.push('<div style="color:#a5d6a7;">GTM: ' + config.tracking.gtm + '</div>');
      if (config.tracking?.facebook_pixel) lines.push('<div style="color:#a5d6a7;">FB: ' + config.tracking.facebook_pixel + '</div>');
    }

    lines.push('<div style="margin-top:6px;color:#bbb;">Visible slots: ' + slots.length + '</div>');
    
    slots.forEach(function(s) {
      var id = s.dataset.adId;
      var rect = s.getBoundingClientRect();
      var visible = rect.width > 0 && rect.height > 0;
      var dot = visible ? '🟢' : '⚪';
      lines.push('<div>' + dot + ' ' + id + '</div>');
    });

    lines.push('<div style="margin-top:8px;border-top:1px solid #555;padding-top:6px;color:#888;font-size:9px;">Remove mock-ad-fill.js<br>before going live</div>');

    // Toggle button
    var toggleBtn = document.createElement('div');
    toggleBtn.style.cssText = 'position:absolute;top:4px;right:8px;cursor:pointer;font-size:14px;opacity:0.6;';
    toggleBtn.textContent = '✕';
    toggleBtn.onclick = function() { panel.style.display = panel.style.display === 'none' ? '' : 'none'; };

    panel.innerHTML = lines.join('');
    panel.appendChild(toggleBtn);
    document.body.appendChild(panel);
  }

  // ----------------------------------------------------------------
  // Mock interstitial overlay
  // ----------------------------------------------------------------
  function mockInterstitial() {
    // Read interstitial config exposed by InterstitialLoader.astro
    var ic = window.__ATL_INTERSTITIAL_CONFIG__ || null;
    if (!ic || !ic.script_url) return;

    // Build overlay
    var overlay = document.createElement('div');
    overlay.id = 'atl-interstitial-mock';
    overlay.style.cssText = [
      'position: fixed', 'inset: 0', 'z-index: 99999',
      'background: rgba(0,0,0,0.75)', 'backdrop-filter: blur(4px)',
      'display: flex', 'align-items: center', 'justify-content: center',
      'opacity: 0', 'transition: opacity 0.3s ease',
      'font-family: -apple-system, BlinkMacSystemFont, sans-serif'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
      'background: #fff', 'border-radius: 12px', 'padding: 24px',
      'max-width: 560px', 'width: 90%', 'max-height: 80vh', 'overflow-y: auto',
      'box-shadow: 0 20px 60px rgba(0,0,0,0.3)',
      'position: relative'
    ].join(';');

    // Close button with countdown delay (reads from config, default 3s)
    var CLOSE_DELAY = (ic.close_delay_seconds != null) ? ic.close_delay_seconds : 3;
    var closeBtn = document.createElement('button');

    function activateCloseBtn() {
      closeBtn.textContent = '\u2715';
      closeBtn.disabled = false;
      closeBtn.style.cssText = [
        'position: absolute', 'top: 12px', 'right: 16px',
        'background: none', 'border: none', 'font-size: 20px',
        'color: #666', 'cursor: pointer', 'line-height: 1',
        'padding: 4px', 'transition: all 0.2s ease'
      ].join(';');
      closeBtn.onmouseenter = function() { closeBtn.style.color = '#000'; };
      closeBtn.onmouseleave = function() { closeBtn.style.color = '#666'; };
    }

    if (CLOSE_DELAY <= 0) {
      activateCloseBtn();
    } else {
      closeBtn.disabled = true;
      closeBtn.style.cssText = [
        'position: absolute', 'top: 12px', 'right: 16px',
        'background: rgba(0,0,0,0.08)', 'border: none', 'font-size: 13px',
        'color: #999', 'cursor: default', 'line-height: 1',
        'padding: 4px 8px', 'border-radius: 4px',
        'font-family: -apple-system, BlinkMacSystemFont, sans-serif',
        'font-weight: 600', 'min-width: 28px', 'text-align: center',
        'transition: all 0.2s ease'
      ].join(';');
      closeBtn.textContent = String(CLOSE_DELAY);

      var remaining = CLOSE_DELAY;
      var countdown = setInterval(function() {
        remaining--;
        if (remaining > 0) {
          closeBtn.textContent = String(remaining);
        } else {
          clearInterval(countdown);
          activateCloseBtn();
        }
      }, 1000);
    }

    closeBtn.onclick = function() {
      if (closeBtn.disabled) return;
      overlay.style.opacity = '0';
      setTimeout(function() { overlay.remove(); }, 300);
    };
    card.appendChild(closeBtn);

    // "AD" badge
    var adBadge = document.createElement('div');
    adBadge.style.cssText = 'font-size:9px;font-weight:700;color:#999;letter-spacing:1px;margin-bottom:8px;';
    adBadge.textContent = 'SPONSORED · INTERSTITIAL';
    card.appendChild(adBadge);

    // Title
    var title = document.createElement('div');
    title.style.cssText = 'font-size:16px;font-weight:700;color:#222;margin-bottom:16px;';
    title.textContent = 'You may like:';
    card.appendChild(title);

    // Mock content grid
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:12px;';

    var mockItems = [
      { title: '10 Hidden Gems You Need to Visit', source: 'TravelNet' },
      { title: 'The Future of AI in Everyday Life', source: 'TechPulse' },
      { title: 'Top Budget Smartphones of 2026', source: 'GadgetPro' },
      { title: 'Easy 15-Minute Dinner Recipes', source: 'FoodDaily' }
    ];
    var colors = ['#1a73e8', '#e65100', '#2e7d32', '#6a1b9a'];

    mockItems.forEach(function(item, i) {
      var itemCard = document.createElement('div');
      itemCard.style.cssText = [
        'border-radius: 8px', 'overflow: hidden',
        'border: 1px solid #eee', 'cursor: pointer',
        'transition: transform 0.15s ease, box-shadow 0.15s ease'
      ].join(';');
      itemCard.onmouseenter = function() { itemCard.style.transform = 'scale(1.02)'; itemCard.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; };
      itemCard.onmouseleave = function() { itemCard.style.transform = 'scale(1)'; itemCard.style.boxShadow = 'none'; };

      var thumb = document.createElement('div');
      thumb.style.cssText = 'width:100%;height:80px;background:' + colors[i] + '22;display:flex;align-items:center;justify-content:center;';
      var thumbIcon = document.createElement('div');
      thumbIcon.style.cssText = 'width:40px;height:40px;border-radius:50%;background:' + colors[i] + '33;';
      thumb.appendChild(thumbIcon);
      itemCard.appendChild(thumb);

      var body = document.createElement('div');
      body.style.cssText = 'padding:10px;';

      var t = document.createElement('div');
      t.style.cssText = 'font-size:13px;font-weight:600;color:#333;line-height:1.3;margin-bottom:4px;';
      t.textContent = item.title;
      body.appendChild(t);

      var s = document.createElement('div');
      s.style.cssText = 'font-size:10px;color:#999;';
      s.textContent = item.source;
      body.appendChild(s);

      itemCard.appendChild(body);
      grid.appendChild(itemCard);
    });

    card.appendChild(grid);

    // Trigger + frequency info
    var info = document.createElement('div');
    info.style.cssText = 'margin-top:16px;padding-top:12px;border-top:1px solid #eee;font-size:10px;color:#999;font-family:monospace;line-height:1.6;';
    var trigger = ic.trigger || {};
    var freq = ic.frequency || {};
    info.innerHTML = '<div style="font-weight:700;color:#ffa000;margin-bottom:4px;">\uD83D\uDFE1 Mock Interstitial</div>' +
      '<div style="color:#e65100;font-size:9px;margin-bottom:4px;">Mock always shows after 2s. Real interstitial respects trigger/frequency/page-type settings below.</div>' +
      'Script: ' + ic.script_url + '<br>' +
      'Trigger: ' + (trigger.type || 'delay') +
        (trigger.type === 'delay' ? ' (' + (trigger.delay_seconds || 5) + 's)' : '') +
        (trigger.type === 'scroll' ? ' (' + (trigger.scroll_percent || 50) + '%)' : '') + '<br>' +
      'Frequency: ' + (freq.type || 'once_per_session') +
        (freq.type === 'custom' ? ' (max ' + (freq.max_per_session || 1) + '/session)' : '') + '<br>' +
      'Pages: ' + (ic.page_types || ['all']).join(', ') + '<br>' +
      'Close delay: ' + CLOSE_DELAY + 's';
    card.appendChild(info);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Close on backdrop click (only after countdown expires)
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay && !closeBtn.disabled) closeBtn.onclick();
    });

    // Fade in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        overlay.style.opacity = '1';
      });
    });
  }

  // Start checking for ad containers
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(fillAll, 500); });
  } else {
    setTimeout(fillAll, 500);
  }

  // Show mock interstitial after a short delay (simulates trigger)
  setTimeout(mockInterstitial, 2000);

  // Re-fill on resize (sizes change between mobile/desktop)
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      document.querySelectorAll('[data-ad-id]').forEach(fillSlot);
    }, 300);
  });
})();
