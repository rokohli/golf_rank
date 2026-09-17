(function () {
  'use strict';

  function getApiBaseUrl() {
    if (window.FAIRWAY_API_URL) return window.FAIRWAY_API_URL.replace(/\/+$/, '');
    const meta = document.querySelector('meta[name="fairway-api-url"]');
    if (meta && meta.content && meta.content.trim()) return meta.content.trim().replace(/\/+$/, '');
    
    // Default to local development API if running on localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:8000';
    }
    // Staging environment default when hosted on Render
    if (window.location.hostname.endsWith('onrender.com')) {
      return 'https://fairway-api-h93s.onrender.com';
    }
    // Production web deployment default to same origin (e.g. reverse proxy or unified domain)
    if (window.location.origin && window.location.origin !== 'null') {
      return window.location.origin.replace(/\/+$/, '');
    }
    return '';
  }

  function getCourseId() {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('id');
    if (idParam && /^[1-9]\d*$/.test(idParam.trim())) {
      return parseInt(idParam.trim(), 10);
    }
    return null;
  }

  function formatPrice(fee) {
    if (fee === null || fee === undefined) return 'Unavailable';
    return '$' + fee;
  }

  function formatLocation(course) {
    const parts = [];
    if (course.city) parts.push(course.city);
    if (course.admin1_code || course.admin1_name) parts.push(course.admin1_code || course.admin1_name);
    if (parts.length > 0) return parts.join(', ');
    return course.region || 'United States';
  }

  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (/^(https?:|\/)/i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  function renderHeroAttribution(heroImage) {
    if (!heroImage) return '';
    const creditText = heroImage.attribution || (heroImage.type === 'WIKIMEDIA' ? 'Wikimedia Commons' : '');
    const cleanSourceUrl = sanitizeUrl(heroImage.source_url);
    const cleanLicenseUrl = sanitizeUrl(heroImage.license_url);

    let creditHtml = '';
    if (creditText) {
      if (cleanSourceUrl) {
        creditHtml = `Photo: <a href="${escapeHtml(cleanSourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(creditText)}</a>`;
      } else {
        creditHtml = `Photo: ${escapeHtml(creditText)}`;
      }
    }

    let licenseHtml = '';
    if (heroImage.license) {
      if (cleanLicenseUrl) {
        licenseHtml = `<a href="${escapeHtml(cleanLicenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(heroImage.license)}</a>`;
      } else {
        licenseHtml = escapeHtml(heroImage.license);
      }
    }

    if (creditHtml && licenseHtml) {
      return `<span class="course-img-attribution">${creditHtml} · ${licenseHtml}</span>`;
    } else if (creditHtml) {
      return `<span class="course-img-attribution">${creditHtml}</span>`;
    } else if (licenseHtml) {
      return `<span class="course-img-attribution">License: ${licenseHtml}</span>`;
    }
    return '';
  }

  function renderCourse(course) {
    const container = document.getElementById('course-container');
    if (!container) return;

    const heroImg = course.hero_image && course.hero_image.url ? course.hero_image.url : null;
    const attributionHtml = renderHeroAttribution(course.hero_image);
    const ratingDisplay = course.community_rating != null ? course.community_rating.toFixed(1) : '—';
    const ratingCountText = course.rating_count ? `${course.rating_count} review${course.rating_count === 1 ? '' : 's'}` : 'No ratings yet';

    const deepLinkUrl = `golfrank://course/${course.id}`;

    container.innerHTML = `
      <div class="course-card-wrapper">
        <article class="course-card">
          <div class="course-hero-img-wrap">
            ${heroImg ? `
              <img src="${escapeHtml(heroImg)}" alt="${escapeHtml(course.name)}" class="course-hero-img">
              ${attributionHtml}
            ` : `
              <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #174C38, #10382A); color: #FFFFFF; font-size: 2.5rem; opacity: 0.85;">
                ⛳️
              </div>
            `}
          </div>

          <div class="course-content">
            <div class="course-header">
              <h1 class="course-name">${escapeHtml(course.name)}</h1>
              ${course.community_rating != null ? `
                <div class="course-rating-badge">
                  <span class="course-rating-star">★</span>
                  <span>${escapeHtml(ratingDisplay)}</span>
                </div>
              ` : ''}
            </div>

            <p class="course-location">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>${escapeHtml(formatLocation(course))}</span>
              <span style="color: var(--muted); font-size: 0.85rem; margin-left: 0.25rem;">• ${escapeHtml(ratingCountText)}</span>
            </p>

            <div class="course-stats-grid">
              <div class="stat-item">
                <span class="stat-label">Par</span>
                <span class="stat-value">${course.par != null ? escapeHtml(String(course.par)) : '—'}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Holes</span>
                <span class="stat-value">${course.hole_count != null ? escapeHtml(String(course.hole_count)) : '—'}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Slope</span>
                <span class="stat-value">${course.slope_rating != null ? escapeHtml(String(course.slope_rating)) : '—'}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Green Fee</span>
                <span class="stat-value">${escapeHtml(formatPrice(course.green_fee))}</span>
              </div>
            </div>

            <div class="course-actions">
              <a href="${escapeHtml(deepLinkUrl)}" id="open-app-btn" class="btn-primary">
                Open in Fairway
              </a>
              <a href="index.html" class="btn-secondary" style="justify-content: center;">
                Back to Fairway
              </a>
            </div>
          </div>
        </article>
      </div>
    `;

    document.title = `${course.name} — Fairway`;

    // Progressive enhancement: try deep link, with smooth fallback to app prompt
    const openBtn = document.getElementById('open-app-btn');
    if (openBtn) {
      openBtn.addEventListener('click', function (e) {
        const start = Date.now();
        setTimeout(function () {
          if (Date.now() - start < 1500) {
            // App didn't open
            alert('To view full rankings and log rounds, open this course inside the Fairway mobile app.');
          }
        }, 1000);
      });
    }
  }

  function renderError(message) {
    const container = document.getElementById('course-container');
    if (!container) return;
    container.innerHTML = `
      <div class="state-box">
        <h2 style="font-size: 1.4rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--ink);">Course Unavailable</h2>
        <p style="color: var(--muted); margin-bottom: 1.5rem;">${escapeHtml(message)}</p>
        <a href="index.html" class="btn-primary">Return to Fairway</a>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadCourse() {
    const courseId = getCourseId();
    if (!courseId) {
      renderError('No valid course ID was provided. Please check the link and try again.');
      return;
    }
    const apiUrl = `${getApiBaseUrl()}/api/v1/courses/${courseId}`;

    try {
      const response = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        if (response.status === 404) {
          renderError(`Course #${courseId} could not be found in the catalog.`);
        } else {
          renderError(`Unable to load course data (HTTP ${response.status}).`);
        }
        return;
      }

      const course = await response.json();
      renderCourse(course);
    } catch (err) {
      renderError('Unable to connect to the Fairway catalog. Please check your connection.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCourse);
  } else {
    loadCourse();
  }
})();
