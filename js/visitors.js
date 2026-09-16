(function () {
  "use strict";

  var COUNT_HIT_API = "https://counterapi.com/api/perry-bis.github.io/view/pageviews";
  var GEO_API = "https://ipapi.co/json/";
  var VISIT_LOG_KEY = "perry_site_visit_logged";
  var REQUEST_TIMEOUT = 8500;

  var config = window.VISITOR_CONFIG || {};
  var supabaseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  var supabaseAnonKey = String(config.supabaseAnonKey || "");
  var hasSupabase = Boolean(
    /^https:\/\/.+\.supabase\.co$/i.test(supabaseUrl) && supabaseAnonKey
  );

  var els = {
    totalViews: document.getElementById("visitor-total-views"),
    totalCountries: document.getElementById("visitor-total-countries"),
    recentList: document.getElementById("visitor-recent-list"),
    map: document.getElementById("visitor-map"),
    status: document.getElementById("visitor-status"),
  };

  function setStatus(message) {
    if (els.status) {
      els.status.textContent = message;
    }
  }

  function safeStorageGet(storageName, key) {
    try {
      return window[storageName].getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeStorageSet(storageName, key, value) {
    try {
      window[storageName].setItem(key, value);
    } catch (error) {
      return false;
    }
    return true;
  }

  function alreadyLoggedThisSession() {
    return safeStorageGet("sessionStorage", VISIT_LOG_KEY) === "1";
  }

  function markLoggedThisSession() {
    safeStorageSet("sessionStorage", VISIT_LOG_KEY, "1");
  }

  function fetchWithTimeout(url, options) {
    var controller = window.AbortController ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) {
        controller.abort();
      }
    }, REQUEST_TIMEOUT);
    var requestOptions = Object.assign({}, options || {});

    if (controller) {
      requestOptions.signal = controller.signal;
    }

    return fetch(url, requestOptions)
      .finally(function () {
        clearTimeout(timeout);
      });
  }

  function fetchJson(url, options) {
    return fetchWithTimeout(url, options)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Request failed: " + response.status);
        }
        return response.json();
      });
  }

  function formatTime(isoString) {
    if (!isoString) {
      return "Just now";
    }

    var date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "Recent";
    }

    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function normalizeCoordinate(value, minimum, maximum) {
    var numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return null;
    }
    if (typeof minimum === "number" && numberValue < minimum) {
      return null;
    }
    if (typeof maximum === "number" && numberValue > maximum) {
      return null;
    }
    return Math.round(numberValue * 100) / 100;
  }

  function normalizeText(value) {
    return typeof value === "string" ? value.trim().slice(0, 80) : "";
  }

  function normalizeVisit(visit) {
    return {
      created_at: visit.created_at || new Date().toISOString(),
      country: normalizeText(visit.country),
      city: normalizeText(visit.city),
      region: normalizeText(visit.region),
      lat: normalizeCoordinate(visit.lat, -90, 90),
      lng: normalizeCoordinate(visit.lng, -180, 180),
    };
  }

  function locationLabel(visit) {
    var parts = [visit.city, visit.region, visit.country].filter(Boolean);
    return parts.join(", ") || "Unknown location";
  }

  function hasCoordinates(visit) {
    return typeof visit.lat === "number" && typeof visit.lng === "number";
  }

  function updateStats(visits, countryCount) {
    if (els.totalCountries) {
      var countries = new Set(
        visits
          .map(function (visit) {
            return visit.country;
          })
          .filter(Boolean)
      );
      var hasTotal =
        countryCount !== null &&
        countryCount !== undefined &&
        Number.isFinite(Number(countryCount));
      var total = hasTotal
        ? Math.max(0, Math.floor(Number(countryCount)))
        : countries.size;
      els.totalCountries.textContent = String(total);
    }
  }

  function renderRecent(visits) {
    if (!els.recentList) {
      return;
    }

    els.recentList.textContent = "";

    if (!visits.length) {
      var empty = document.createElement("li");
      empty.className = "visitor-empty";
      empty.textContent = "No visits recorded yet.";
      els.recentList.appendChild(empty);
      return;
    }

    visits.slice(0, 12).forEach(function (visit) {
      var item = document.createElement("li");
      item.className = "visitor-item";

      var location = document.createElement("span");
      location.className = "visitor-item-location";
      location.textContent = locationLabel(visit);

      var time = document.createElement("span");
      time.className = "visitor-item-time";
      time.textContent = formatTime(visit.created_at);

      item.appendChild(location);
      item.appendChild(time);
      els.recentList.appendChild(item);
    });
  }

  function groupVisitsByLocation(visits) {
    var groups = new Map();

    visits.forEach(function (visit) {
      if (!hasCoordinates(visit)) {
        return;
      }

      var key = [
        visit.lat.toFixed(3),
        visit.lng.toFixed(3),
        locationLabel(visit),
      ].join("|");

      if (!groups.has(key)) {
        groups.set(key, {
          visit: visit,
          count: 0,
        });
      }

      groups.get(key).count += 1;
    });

    return Array.from(groups.values());
  }

  function createMarkerIcon(count) {
    var countLabel = count > 1 ? '<span class="visitor-pin-count">' + count + "</span>" : "";

    return window.L.divIcon({
      className: "visitor-pin",
      html: '<span class="visitor-pin-dot">' + countLabel + "</span>",
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  function createPopupContent(group) {
    var wrap = document.createElement("div");
    var title = document.createElement("strong");
    var meta = document.createElement("span");

    title.textContent = locationLabel(group.visit);
    meta.textContent =
      group.count === 1
        ? formatTime(group.visit.created_at)
        : group.count + " visits, latest " + formatTime(group.visit.created_at);

    wrap.appendChild(title);
    wrap.appendChild(document.createElement("br"));
    wrap.appendChild(meta);

    return wrap;
  }

  function showMapFallback(message) {
    if (!els.map) {
      return;
    }

    els.map.textContent = "";
    var fallback = document.createElement("div");
    fallback.className = "visitor-map-fallback";
    fallback.textContent = message;
    els.map.appendChild(fallback);
  }

  function initMap(visits) {
    if (!els.map) {
      return;
    }

    if (!window.L) {
      showMapFallback("Map library could not be loaded.");
      return;
    }

    var locationGroups = groupVisitsByLocation(visits);
    var map = window.L.map("visitor-map", {
      zoomControl: true,
      scrollWheelZoom: false,
    }).setView([20, 0], 2);

    window.L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }
    ).addTo(map);

    locationGroups.forEach(function (group) {
      window.L.marker([group.visit.lat, group.visit.lng], {
        icon: createMarkerIcon(group.count),
      })
        .addTo(map)
        .bindPopup(createPopupContent(group));
    });

    if (locationGroups.length === 1) {
      map.setView([locationGroups[0].visit.lat, locationGroups[0].visit.lng], 4);
    } else if (locationGroups.length > 1) {
      var bounds = window.L.latLngBounds(
        locationGroups.map(function (group) {
          return [group.visit.lat, group.visit.lng];
        })
      );
      map.fitBounds(bounds.pad(0.25), { maxZoom: 4 });
    }

    setTimeout(function () {
      map.invalidateSize();
    }, 120);
  }

  function loadFromSupabase() {
    var url =
      supabaseUrl +
      "/rest/v1/visits?select=created_at,country,city,region,lat,lng&order=created_at.desc&limit=200";

    return fetchJson(url, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: "Bearer " + supabaseAnonKey,
      },
    }).then(function (visits) {
      return visits.map(normalizeVisit);
    });
  }

  function loadCountryCount() {
    var url = supabaseUrl + "/rest/v1/rpc/visitor_country_count";

    return fetchJson(url, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: "Bearer " + supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: "{}",
    }).then(function (value) {
      var total = Number(value);
      return Number.isFinite(total) && total >= 0 ? total : null;
    });
  }

  function saveToSupabase(visit) {
    var url = supabaseUrl + "/rest/v1/visits";

    return fetchWithTimeout(url, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: "Bearer " + supabaseAnonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(visit),
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Supabase insert failed: " + response.status);
      }
    });
  }

  function loadPageViewTotal() {
    return fetchJson(COUNT_HIT_API, { cache: "no-store" }).then(function (data) {
      var total = Number(data && data.value);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error("Counter returned an invalid value");
      }
      if (els.totalViews) {
        els.totalViews.textContent = Math.floor(total).toLocaleString();
      }
      return total;
    });
  }

  function getGeo() {
    return fetchJson(GEO_API).then(function (geo) {
      if (geo && geo.error) {
        throw new Error(geo.message || "Location lookup failed");
      }
      return {
        country: geo.country_name || geo.country || "",
        city: geo.city || "",
        region: geo.region || "",
        lat: normalizeCoordinate(geo.latitude, -90, 90),
        lng: normalizeCoordinate(geo.longitude, -180, 180),
      };
    });
  }

  function recordVisit() {
    if (hasSupabase && alreadyLoggedThisSession()) {
      return Promise.resolve(null);
    }

    return getGeo()
      .then(function (geo) {
        var visit = normalizeVisit({
          country: geo.country,
          city: geo.city,
          region: geo.region,
          lat: geo.lat,
          lng: geo.lng,
        });

        if (hasSupabase) {
          return saveToSupabase(visit).then(function () {
            markLoggedThisSession();
            return visit;
          });
        }

        return visit;
      })
      .catch(function () {
        return null;
      });
  }

  function bootstrap() {
    setStatus("Loading visitor analytics...");

    var visitsPromise = hasSupabase
      ? loadFromSupabase()
          .then(function (visits) {
            return { items: visits, available: true };
          })
          .catch(function () {
            return { items: [], available: false };
          })
      : Promise.resolve({ items: [], available: true });

    var countPromise = loadPageViewTotal()
      .then(function () {
        return true;
      })
      .catch(function () {
        if (els.totalViews) {
          els.totalViews.textContent = "Offline";
        }
        return false;
      });

    var recordPromise = recordVisit();
    var countryCountPromise = hasSupabase
      ? recordPromise
          .then(function () {
            return loadCountryCount();
          })
          .catch(function () {
            return null;
          })
      : Promise.resolve(null);

    Promise.all([visitsPromise, countPromise, recordPromise, countryCountPromise])
      .then(function (results) {
        var history = results[0];
        var countAvailable = results[1];
        var currentVisit = results[2];
        var countryCount = results[3];
        var visits = history.items;

        if (
          currentVisit &&
          !visits.some(function (visit) {
            return visit.created_at === currentVisit.created_at;
          })
        ) {
          visits = [currentVisit].concat(visits);
        }

        updateStats(visits, countryCount);
        renderRecent(visits);
        initMap(visits);

        if (hasSupabase && !history.available) {
          setStatus("Visitor history is temporarily unavailable.");
        } else if (!countAvailable) {
          setStatus(
            visits.length
              ? "Visitor locations are available. Page view counter is temporarily unavailable."
              : "Visitor analytics are temporarily unavailable."
          );
        } else if (!hasSupabase && !currentVisit) {
          setStatus("Page views are live. Location lookup is temporarily unavailable.");
        } else if (hasSupabase) {
          setStatus("Live visitor map and visit log are active.");
        } else {
          setStatus("Page views are live. Supabase adds the full visitor history.");
        }
      })
      .catch(function () {
        setStatus("Visitor analytics could not be loaded.");
        renderRecent([]);
        initMap([]);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
