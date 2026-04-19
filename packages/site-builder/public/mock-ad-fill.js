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
      'width: 100%',
      'max-width: ' + w + 'px',
      'height: ' + h + 'px',
      'background: ' + mock.bg,
      'border: 2px dashed ' + mock.color,
      'border-radius: 8px',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'justify-content: center',
      'margin: 8px auto',
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

  // Start checking for ad containers
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(fillAll, 500); });
  } else {
    setTimeout(fillAll, 500);
  }

  // Re-fill on resize (sizes change between mobile/desktop)
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      document.querySelectorAll('[data-ad-id]').forEach(fillSlot);
    }, 300);
  });
})();
