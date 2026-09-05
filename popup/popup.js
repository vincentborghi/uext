const DEFAULT_BNF_PROXY = 'https://acces-distant.bnf.fr/login?url=';

const FIP_STATIONS = {
  fip: {
    id: 'fip',
    name: 'FIP Direct',
    stationId: 7,
    streamUrl: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
    pullId: 7,
    tag: 'fip',
    webUrl: 'https://www.radiofrance.fr/fip'
  },
  fip_nouveautes: {
    id: 'fip_nouveautes',
    name: 'FIP Nouveautes',
    stationId: 70,
    streamUrl: 'https://icecast.radiofrance.fr/fipnouveautes-midfi.mp3',
    pullId: 70,
    tag: 'fip-nouveautes',
    webUrl: 'https://www.radiofrance.fr/fip/radio-nouveautes'
  },
  fip_cultes: {
    id: 'fip_cultes',
    name: 'FIP Cultes',
    stationId: 709,
    streamUrl: 'https://icecast.radiofrance.fr/fipculte-midfi.mp3',
    pullId: null,
    tag: 'fip-culte',
    webUrl: 'https://www.radiofrance.fr/fip/radio-cultes'
  },
  fip_sacre_francais: {
    id: 'fip_sacre_francais',
    name: 'FIP Sacre Francais',
    stationId: 96,
    streamUrl: 'https://icecast.radiofrance.fr/fipsacrefrancais-midfi.mp3',
    pullId: null,
    tag: 'fip-sacre-francais',
    webUrl: 'https://www.radiofrance.fr/fip/radio-sacre-francais'
  },
  fip_jazz: {
    id: 'fip_jazz',
    name: 'FIP Jazz',
    stationId: 65,
    streamUrl: 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3',
    pullId: 65,
    tag: 'fip-jazz',
    webUrl: 'https://www.radiofrance.fr/fip/radio-jazz'
  }
};

let currentStationKey = 'fip';

function getActiveStation() {
  return FIP_STATIONS[currentStationKey] || FIP_STATIONS.fip;
}

let currentFipTrack = null;
let activeTabInfo = null;
let currentLibrary = [];
let detectedEvents = [];
let trackModalInstance = null;

async function getTargetTab() {
  const isStandalone = window.location.search.includes('mode=window') ||
                       (window.location.protocol === 'chrome-extension:' && (window.outerWidth > 800 || window.outerHeight > 620));

  if (!isStandalone) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && !tab.url.startsWith('chrome-extension://')) {
        return tab;
      }
    } catch (e) {
      console.warn('Error querying active tab in current window:', e);
    }
  }

  try {
    const normalWindows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
    normalWindows.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
    for (const win of normalWindows) {
      if (win.tabs && win.tabs.length > 0) {
        const activeTab = win.tabs.find((t) => t.active && t.url && !t.url.startsWith('chrome-extension://'));
        if (activeTab) return activeTab;
      }
    }
  } catch (e) {
    console.warn('Error finding active tab in normal windows:', e);
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url && !tab.url.startsWith('chrome-extension://')) {
      return tab;
    }
  } catch (e) {
    console.warn('Error querying last focused window tab:', e);
  }

  return null;
}

async function initStandaloneWindowMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const isWindowMode = urlParams.get('mode') === 'window';
  const isDetached = isWindowMode || (window.location.protocol === 'chrome-extension:' && (window.outerWidth > 800 || window.outerHeight > 620));

  const popoutBtn = document.getElementById('btn-popout-window');
  const popoutText = document.getElementById('popout-btn-text');
  const chkAlwaysWindow = document.getElementById('chk-always-window');

  if (isDetached) {
    document.body.classList.add('standalone-window');
    if (popoutText) popoutText.textContent = 'New Tab';
    if (popoutBtn) {
      popoutBtn.title = 'Open My Extras in a browser tab';
      popoutBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=window') });
      });
    }
  } else {
    const settings = await chrome.storage.local.get({ alwaysOpenAsWindow: false });
    if (settings.alwaysOpenAsWindow) {
      await openStandaloneWindow();
      return;
    }

    if (popoutBtn) {
      popoutBtn.addEventListener('click', openStandaloneWindow);
    }
  }

  if (chkAlwaysWindow) {
    const settings = await chrome.storage.local.get({ alwaysOpenAsWindow: false });
    chkAlwaysWindow.checked = Boolean(settings.alwaysOpenAsWindow);
    chkAlwaysWindow.addEventListener('change', async (e) => {
      await chrome.storage.local.set({ alwaysOpenAsWindow: e.target.checked });
    });
  }
}

async function openStandaloneWindow() {
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup/popup.html?mode=window'),
    type: 'popup',
    width: 960,
    height: 850
  });
  window.close();
}

document.addEventListener('DOMContentLoaded', async () => {
  await initStandaloneWindowMode();
  setupNavigation();
  setupStarRatingListeners();
  await setupFipModule();
  setupLibraryModule();
  setupEventsModule();
  setupBnfModule();

  if (window.bootstrap && window.bootstrap.Modal) {
    const modalEl = document.getElementById('trackModal');
    trackModalInstance = new bootstrap.Modal(modalEl);
  }

  await loadActiveTabInfo();
  await refreshFipLive();
  await loadLibrary();
});

async function loadActiveTabInfo() {
  try {
    const tab = await getTargetTab();
    if (tab) {
      activeTabInfo = tab;
      const bnfUrlEl = document.getElementById("bnf-current-url");
      if (bnfUrlEl) {
        bnfUrlEl.textContent = tab.url || "No active URL";
      }

      // Check for pending calendar selection from context menu
      const storageRes = await chrome.storage.local.get({ pendingCalendarSelection: "" });
      let pendingSel = (storageRes.pendingCalendarSelection || "").trim();
      if (pendingSel) {
        await chrome.storage.local.remove("pendingCalendarSelection");
      }

      // Try smart page extraction on the active tab
      if (tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: runSmartPageExtractor,
            args: [false]
          });
          const pageData = results?.[0]?.result || {};

          if (pendingSel) {
            pageData.selection = pendingSel;
            pageData.sample = pendingSel;
            const targetBtn = document.querySelector('#nav-tabs button[data-bs-target="#tab-events"]');
            if (targetBtn && window.bootstrap && window.bootstrap.Tab) {
              bootstrap.Tab.getOrCreateInstance(targetBtn).show();
            }
          }

          updateSelectionBanner(pageData.selection, false);

          const eventTitleEl = document.getElementById("event-input-title");
          const eventLocationEl = document.getElementById("event-input-location");

          if (eventTitleEl && pageData.formattedTitle) {
            eventTitleEl.value = pageData.formattedTitle;
          } else if (eventTitleEl && pageData.title && (!eventTitleEl.value || eventTitleEl.value.startsWith("www."))) {
            eventTitleEl.value = pageData.title;
          }

          if (eventLocationEl && pageData.location) {
            eventLocationEl.value = pageData.location;
          }

          // If structured dates or sample text exists, pre-detect
          if ((pageData.structuredDates && pageData.structuredDates.length > 0) || pageData.sample) {
            detectedEvents = extractDatesFromMetadata(pageData);
            renderDetectedDates();
          }

          // If image page detected, guide user to click AI Smart Scan
          if (pageData.isImagePage || (tab.url && /\.(jpe?g|png|webp|gif|bmp|avif)(\?.*)?$/i.test(tab.url))) {
            const emptyMsg = document.getElementById("events-empty-msg");
            if (emptyMsg && detectedEvents.length === 0) {
              emptyMsg.innerHTML = `<span class="text-primary fw-semibold">Image flyer detected.</span> Click <strong>AI Smart Scan</strong> above to analyze this poster with Gemini Vision.`;
            }
          }
        } catch (e) {
          // Fallback simple title
          const eventTitleEl = document.getElementById("event-input-title");
          if (eventTitleEl && !eventTitleEl.value && tab.title) {
            const isFileTitle = /\.(jpe?g|png|webp|gif|bmp)(\?.*)?$/i.test(tab.title) || /^\d{6,}/.test(tab.title);
            if (!isFileTitle) {
              const cleanTitle = tab.title.replace(/\s*[\-\u2013|].*$/, "").replace(/^concert\s*[:\-]?\s*/i, "").trim();
              eventTitleEl.value = cleanTitle || tab.title;
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to get active tab:", err);
  }
}

function updateSelectionBanner(selectionText, isFullPageForce = false) {
  const banner = document.getElementById("selection-focus-banner");
  const countEl = document.getElementById("selection-char-count");
  if (!banner) return;
  const hasSel = Boolean(selectionText && selectionText.trim().length > 0 && !isFullPageForce);
  if (hasSel) {
    if (countEl) countEl.textContent = String(selectionText.trim().length);
    banner.classList.remove("d-none");
  } else {
    banner.classList.add("d-none");
  }
}

async function refreshCalendarExtractionFromTab() {
  try {
    const tab = await getTargetTab();
    if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runSmartPageExtractor,
      args: [false]
    });
    const pageData = results?.[0]?.result;
    if (pageData) {
      updateSelectionBanner(pageData.selection, false);
      if (pageData.selection && pageData.selection.trim().length > 0) {
        const eventTitleEl = document.getElementById("event-input-title");
        const eventLocationEl = document.getElementById("event-input-location");

        if (eventTitleEl && pageData.formattedTitle) {
          eventTitleEl.value = pageData.formattedTitle;
        }
        if (eventLocationEl && pageData.location) {
          eventLocationEl.value = pageData.location;
        }

        detectedEvents = extractDatesFromMetadata(pageData);
        renderDetectedDates();
      }
    }
  } catch (e) {
    // Ignore errors on non-accessible pages
  }
}

function setupNavigation() {
  const tabs = document.querySelectorAll('#nav-tabs button');
  
  tabs.forEach((tabBtn) => {
    tabBtn.addEventListener('shown.bs.tab', (event) => {
      const targetId = event.target.getAttribute('data-bs-target');
      if (targetId) {
        chrome.storage.local.set({ lastActiveTab: targetId });
      }
      if (tabBtn.id === 'tab-bnf-btn') {
        loadActiveTabInfo();
      }
      if (tabBtn.id === 'tab-events-btn') {
        refreshCalendarExtractionFromTab();
      }
    });
  });

  // Restore the last active tab
  chrome.storage.local.get({ lastActiveTab: '#tab-fip' }, (res) => {
    const lastTabTarget = res.lastActiveTab || '#tab-fip';
    if (lastTabTarget && lastTabTarget !== '#tab-fip') {
      const targetBtn = document.querySelector(`#nav-tabs button[data-bs-target="${lastTabTarget}"]`);
      if (targetBtn) {
        if (window.bootstrap && window.bootstrap.Tab) {
          const tabInstance = bootstrap.Tab.getOrCreateInstance(targetBtn);
          tabInstance.show();
        } else {
          targetBtn.click();
        }
      }
    }
  });
}

// STAR RATING COMPONENT
function setupStarRatingListeners() {
  const setupWidget = (containerId) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const stars = container.querySelectorAll(".star-item");
    stars.forEach((star) => {
      star.addEventListener("click", () => {
        const val = parseInt(star.getAttribute("data-val"), 10);
        const currentVal = parseInt(container.getAttribute("data-rating"), 10) || 0;
        const newVal = currentVal === val ? 0 : val;
        setStarRating(containerId, newVal);
      });
    });
  };

  setupWidget("fip-star-rating");
  setupWidget("modal-star-rating");
}

function setStarRating(containerId, rating) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.setAttribute("data-rating", rating);
  const stars = container.querySelectorAll(".star-item");
  stars.forEach((star) => {
    const val = parseInt(star.getAttribute("data-val"), 10);
    if (val <= rating) {
      star.classList.add("active");
    } else {
      star.classList.remove("active");
    }
  });
}

function renderStarDisplay(rating) {
  let starsHtml = "";
  for (let i = 1; i <= 5; i++) {
    const activeClass = i <= rating ? "active text-warning" : "text-muted opacity-25";
    starsHtml += `<span class="${activeClass}">&#9733;</span>`;
  }
  return `<span class="star-rating d-inline-flex gap-0" style="font-size:0.9rem;">${starsHtml}</span>`;
}

// 1. FIP LIVE MODULE
async function setupFipModule() {
  const stationSelect = document.getElementById("fip-station-select");
  const refreshBtn = document.getElementById("fip-refresh-btn");
  const saveBtn = document.getElementById("fip-save-library-btn");
  const playBtn = document.getElementById("fip-play-btn");
  const audioEl = document.getElementById("fip-audio-element");

  // Load saved station preference
  const savedStationRes = await chrome.storage.local.get({ selectedFipStation: "fip" });
  if (savedStationRes.selectedFipStation && FIP_STATIONS[savedStationRes.selectedFipStation]) {
    currentStationKey = savedStationRes.selectedFipStation;
    if (stationSelect) {
      stationSelect.value = currentStationKey;
    }
  }

  const websiteLink = document.getElementById("fip-link-website");
  const updateWebsiteLink = (st) => {
    if (websiteLink) {
      websiteLink.href = (st && st.webUrl) ? st.webUrl : "https://www.radiofrance.fr/fip";
    }
  };
  updateWebsiteLink(getActiveStation());

  if (stationSelect) {
    stationSelect.addEventListener("change", async (e) => {
      currentStationKey = e.target.value;
      await chrome.storage.local.set({ selectedFipStation: currentStationKey });
      const station = getActiveStation();
      updateWebsiteLink(station);

      if (audioEl && !audioEl.paused) {
        audioEl.src = station.streamUrl;
        audioEl.play().catch((err) => console.warn("Audio stream play error:", err));
        if (playBtn) {
          playBtn.textContent = "Stop";
          playBtn.classList.replace("btn-outline-primary", "btn-danger");
        }
      } else if (playBtn) {
        playBtn.textContent = "Play";
        playBtn.classList.replace("btn-danger", "btn-outline-primary");
      }

      await refreshFipLive();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshFipLive);
  }

  if (playBtn && audioEl) {
    playBtn.textContent = "Play";

    playBtn.addEventListener("click", () => {
      const station = getActiveStation();
      if (audioEl.paused) {
        audioEl.src = station.streamUrl;
        audioEl.play().catch((err) => console.warn("Audio stream play error:", err));
        playBtn.textContent = "Stop";
        playBtn.classList.replace("btn-outline-primary", "btn-danger");
      } else {
        audioEl.pause();
        audioEl.src = "";
        playBtn.textContent = "Play";
        playBtn.classList.replace("btn-danger", "btn-outline-primary");
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!currentFipTrack) return;
      const rating = parseInt(document.getElementById("fip-star-rating").getAttribute("data-rating"), 10) || 0;
      const tagsRaw = document.getElementById("fip-input-tags").value;
      const notes = document.getElementById("fip-input-notes").value.trim();

      const tags = tagsRaw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);

      if (!tags.includes("fip")) {
        tags.unshift("fip");
      }
      if (currentFipTrack.stationTag && !tags.includes(currentFipTrack.stationTag)) {
        tags.push(currentFipTrack.stationTag);
      }

      const trackToSave = {
        id: "trk_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        title: currentFipTrack.title || "Unknown Title",
        artist: currentFipTrack.artist || "Unknown Artist",
        album: currentFipTrack.album || "",
        year: currentFipTrack.year || "",
        origin: currentFipTrack.origin || "FIP",
        tags: tags,
        rating: rating,
        notes: notes,
        coverUrl: currentFipTrack.coverUrl || "",
        links: currentFipTrack.links || {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      saveTrackToLibrary(trackToSave);

      const alertEl = document.getElementById("fip-save-alert");
      if (alertEl) {
        alertEl.classList.remove("d-none");
        setTimeout(() => alertEl.classList.add("d-none"), 3000);
      }
    });
  }
}

async function refreshFipLive() {
  const loadingEl = document.getElementById("fip-loading");
  const loadingTextEl = document.getElementById("fip-loading-text");
  const contentEl = document.getElementById("fip-content");
  const titleEl = document.getElementById("fip-title");
  const artistEl = document.getElementById("fip-artist");
  const albumEl = document.getElementById("fip-album");
  const coverEl = document.getElementById("fip-cover");

  const station = getActiveStation();
  if (loadingTextEl) {
    loadingTextEl.textContent = "Fetching live track from " + station.name + "...";
  }

  try {
    loadingEl.classList.remove("d-none");
    contentEl.classList.add("opacity-50");

    let title = "";
    let artist = "";
    let album = "";
    let year = "";
    let cover = "";

    // 1. Try pullId first if available (provides rich metadata: album, year)
    if (station.pullId) {
      try {
        const pullUrl = "https://api.radiofrance.fr/livemeta/pull/" + station.pullId + "?ts=" + Date.now();
        const pullResp = await fetch(pullUrl);
        if (pullResp.ok) {
          const pullData = await pullResp.json();
          const nowTs = Math.floor(Date.now() / 1000);
          const steps = Object.values(pullData.steps || {});
          const songs = steps.filter((s) => s && (s.embedType === "song" || s.title));
          let songData = songs.find((s) => s.start <= nowTs && nowTs <= s.end);
          if (!songData && songs.length > 0) {
            songs.sort((a, b) => (b.start || 0) - (a.start || 0));
            songData = songs[0];
          }
          if (songData) {
            title = songData.title || songData.name || "";
            artist = songData.authors || songData.performers || (songData.highlightedArtists && songData.highlightedArtists[0]) || songData.artist || "";
            album = songData.titreAlbum || songData.album?.title || songData.album || "";
            year = songData.anneeEditionMusique || songData.releaseYear || songData.year || "";
            cover = songData.visual || songData.coverUrl || songData.cover?.src || "";
          }
        }
      } catch (pullErr) {
        console.warn("Pull fetch failed, falling back to live endpoint:", pullErr);
      }
    }

    // 2. If no song from pull, fetch transistor live endpoint
    if (!title || !artist) {
      const liveUrl = "https://api.radiofrance.fr/livemeta/live/" + station.stationId + "/transistor_musical_player?ts=" + Date.now();
      const liveResp = await fetch(liveUrl);
      if (liveResp.ok) {
        const liveData = await liveResp.json();
        const now = liveData.now || {};
        const secondLine = (now.secondLine || "").trim();
        if (secondLine.includes(" \u2022 ")) {
          const parts = secondLine.split(" \u2022 ");
          artist = parts[0].trim();
          title = parts.slice(1).join(" \u2022 ").trim();
        } else if (secondLine.includes(" - ")) {
          const parts = secondLine.split(" - ");
          artist = parts[0].trim();
          title = parts.slice(1).join(" - ").trim();
        } else if (secondLine) {
          title = secondLine;
          artist = now.firstLine || station.name;
        }

        if (!album && now.firstLine) {
          album = now.firstLine;
        }

        if (!cover && now.cover) {
          cover = "https://www.radiofrance.fr/pikapi/images/" + now.cover + "/400x400";
        }
      }
    }

    title = title || "Unknown Track";
    artist = artist || "Unknown Artist";
    cover = cover || "../icons/icon48.png";

    currentFipTrack = {
      title,
      artist,
      album,
      year,
      origin: station.name,
      stationTag: station.tag,
      coverUrl: cover,
      links: generateSearchLinks(artist, title)
    };

    titleEl.textContent = title;
    artistEl.textContent = artist;
    albumEl.textContent = [album, year].filter(Boolean).join(" - ") || station.name;
    coverEl.src = cover;

    updateSearchLinks("fip-link-", currentFipTrack.links);
  } catch (err) {
    console.warn("Could not fetch FIP live directly:", err);
    titleEl.textContent = station.name + " Live";
    artistEl.textContent = "Radio France";
    albumEl.textContent = "Click refresh or open FIP website";
    coverEl.src = "../icons/icon48.png";
  } finally {
    loadingEl.classList.add("d-none");
    contentEl.classList.remove("opacity-50");
  }
}

function generateSearchLinks(artist, title) {
  const query = encodeURIComponent((artist + " " + title).trim());
  return {
    youtube: `https://www.youtube.com/results?search_query=${query}`,
    discogs: `https://www.discogs.com/search/?q=${query}&type=all`,
    spotify: `https://open.spotify.com/search/${query}`,
    wikipedia: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(artist)}`,
    bandcamp: `https://bandcamp.com/search?q=${query}`
  };
}

function updateSearchLinks(prefix, links) {
  const yt = document.getElementById(prefix + "yt");
  const discogs = document.getElementById(prefix + "discogs");
  const spotify = document.getElementById(prefix + "spotify");
  const wiki = document.getElementById(prefix + "wiki");
  const bandcamp = document.getElementById(prefix + "bandcamp");

  if (yt && links.youtube) yt.href = links.youtube;
  if (discogs && links.discogs) discogs.href = links.discogs;
  if (spotify && links.spotify) spotify.href = links.spotify;
  if (wiki && links.wikipedia) wiki.href = links.wikipedia;
  if (bandcamp && links.bandcamp) bandcamp.href = links.bandcamp;
}

// 2. GLOBAL MUSIC LIBRARY MODULE
function setupLibraryModule() {
  const searchInput = document.getElementById("library-search-input");
  const filterOrigin = document.getElementById("library-filter-origin");
  const filterRating = document.getElementById("library-filter-rating");
  const filterTag = document.getElementById("library-filter-tag");
  const addBtn = document.getElementById("library-manual-add-btn");
  const modalSaveBtn = document.getElementById("modal-track-save-btn");

  const exportJsonBtn = document.getElementById("export-json-btn");
  const exportCsvBtn = document.getElementById("export-csv-btn");
  const importInput = document.getElementById("import-json-input");

  searchInput.addEventListener("input", filterAndRenderLibrary);
  filterOrigin.addEventListener("change", filterAndRenderLibrary);
  filterRating.addEventListener("change", filterAndRenderLibrary);
  filterTag.addEventListener("change", filterAndRenderLibrary);

  addBtn.addEventListener("click", () => openTrackModal(null));
  modalSaveBtn.addEventListener("click", handleModalSave);

  exportJsonBtn.addEventListener("click", exportLibraryAsJson);
  exportCsvBtn.addEventListener("click", exportLibraryAsCsv);
  importInput.addEventListener("change", handleImportJson);
}

async function loadLibrary() {
  const res = await chrome.storage.local.get({ musicLibrary: [] });
  currentLibrary = res.musicLibrary || [];
  updateLibraryBadge();
  populateTagFilter();
  filterAndRenderLibrary();
}

async function saveTrackToLibrary(track) {
  const existingIndex = currentLibrary.findIndex((t) => t.id === track.id);
  if (existingIndex >= 0) {
    currentLibrary[existingIndex] = track;
  } else {
    currentLibrary.unshift(track);
  }
  await chrome.storage.local.set({ musicLibrary: currentLibrary });
  updateLibraryBadge();
  populateTagFilter();
  filterAndRenderLibrary();
}

async function deleteTrackFromLibrary(trackId) {
  currentLibrary = currentLibrary.filter((t) => t.id !== trackId);
  await chrome.storage.local.set({ musicLibrary: currentLibrary });
  updateLibraryBadge();
  populateTagFilter();
  filterAndRenderLibrary();
}

function updateLibraryBadge() {
  const badge = document.getElementById("library-count-badge");
  if (badge) {
    badge.textContent = currentLibrary.length;
  }
}

function populateTagFilter() {
  const tagSelect = document.getElementById("library-filter-tag");
  if (!tagSelect) return;

  const currentSelection = tagSelect.value;
  const tagSet = new Set();
  currentLibrary.forEach((t) => {
    (t.tags || []).forEach((tag) => tagSet.add(tag));
  });

  tagSelect.innerHTML = `<option value="">All Tags</option>`;
  Array.from(tagSet).sort().forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = tag;
    if (tag === currentSelection) opt.selected = true;
    tagSelect.appendChild(opt);
  });
}

function filterAndRenderLibrary() {
  const container = document.getElementById("library-tracks-container");
  const emptyMsg = document.getElementById("library-empty-msg");
  const term = document.getElementById("library-search-input").value.toLowerCase().trim();
  const selectedOrigin = document.getElementById("library-filter-origin").value;
  const selectedRating = parseInt(document.getElementById("library-filter-rating").value, 10) || 0;
  const selectedTag = document.getElementById("library-filter-tag").value;

  const filtered = currentLibrary.filter((track) => {
    if (selectedOrigin && track.origin !== selectedOrigin) return false;
    if (selectedRating && (track.rating || 0) < selectedRating) return false;
    if (selectedTag && !(track.tags || []).includes(selectedTag)) return false;

    if (term) {
      const matchTitle = (track.title || "").toLowerCase().includes(term);
      const matchArtist = (track.artist || "").toLowerCase().includes(term);
      const matchAlbum = (track.album || "").toLowerCase().includes(term);
      const matchNotes = (track.notes || "").toLowerCase().includes(term);
      const matchTags = (track.tags || []).some((tg) => tg.toLowerCase().includes(term));
      if (!matchTitle && !matchArtist && !matchAlbum && !matchNotes && !matchTags) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = "";
    emptyMsg.classList.remove("d-none");
    return;
  }

  emptyMsg.classList.add("d-none");
  container.innerHTML = "";

  filtered.forEach((track) => {
    const card = document.createElement("div");
    card.className = "card shadow-sm p-2 track-card bg-white";

    const tagBadges = (track.tags || [])
      .map((tag) => `<span class="tag-badge">#${escapeHtml(tag)}</span>`)
      .join(" ");

    const links = track.links || generateSearchLinks(track.artist, track.title);
    const createdStr = track.createdAt ? new Date(track.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
    const updatedStr = (track.updatedAt && track.updatedAt !== track.createdAt) ? new Date(track.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";

    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-start mb-1">
        <div class="min-w-0 flex-grow-1 me-2">
          <div class="fw-bold text-dark text-truncate">${escapeHtml(track.title)}</div>
          <div class="small text-secondary text-truncate">${escapeHtml(track.artist)} ${track.album ? `• <em>${escapeHtml(track.album)}</em>` : ""} ${track.year ? `(${escapeHtml(track.year)})` : ""}</div>
        </div>
        <div class="text-end flex-shrink-0">
          <span class="badge bg-secondary origin-badge">${escapeHtml(track.origin || "Manual")}</span>
          <div>${renderStarDisplay(track.rating || 0)}</div>
        </div>
      </div>
      ${track.notes ? `<div class="small text-muted mb-1 fst-italic">"${escapeHtml(track.notes)}"</div>` : ""}
      <div class="d-flex justify-content-between align-items-center text-muted mb-1" style="font-size:0.7rem;">
        <span>${createdStr ? `Added: ${createdStr}` : ""}</span>
        ${updatedStr ? `<span>(Mod: ${updatedStr})</span>` : ""}
      </div>
      <div class="d-flex flex-wrap gap-1 align-items-center justify-content-between mt-1 pt-1 border-top">
        <div class="d-flex flex-wrap gap-1 align-items-center">
          ${tagBadges}
        </div>
        <div class="d-flex gap-1 align-items-center">
          <a href="${links.youtube}" target="_blank" class="badge bg-danger text-decoration-none py-1">YT</a>
          <a href="${links.discogs}" target="_blank" class="badge bg-dark text-decoration-none py-1">Discogs</a>
          <a href="${links.spotify}" target="_blank" class="badge bg-success text-decoration-none py-1">Spotify</a>
          <button class="btn btn-sm btn-outline-secondary py-0 px-2 btn-edit-track" title="Edit track" style="font-size:0.75rem;">Edit</button>
          <button class="btn btn-sm btn-outline-danger py-0 px-2 btn-delete-track" title="Delete track" style="font-size:0.75rem;">Del</button>
        </div>
      </div>
    `;

    card.querySelector(".btn-edit-track").addEventListener("click", () => openTrackModal(track));
    card.querySelector(".btn-delete-track").addEventListener("click", () => {
      if (confirm(`Remove "${track.title}" from library?`)) {
        deleteTrackFromLibrary(track.id);
      }
    });

    container.appendChild(card);
  });
}

function openTrackModal(track) {
  const modalIdEl = document.getElementById("modal-track-id");
  const modalTitleEl = document.getElementById("modal-track-title");
  const modalArtistEl = document.getElementById("modal-track-artist");
  const modalAlbumEl = document.getElementById("modal-track-album");
  const modalYearEl = document.getElementById("modal-track-year");
  const modalOriginEl = document.getElementById("modal-track-origin");
  const modalTagsEl = document.getElementById("modal-track-tags");
  const modalNotesEl = document.getElementById("modal-track-notes");
  const modalLabel = document.getElementById("trackModalLabel");

  if (track) {
    modalLabel.textContent = "Edit Track";
    modalIdEl.value = track.id;
    modalTitleEl.value = track.title || "";
    modalArtistEl.value = track.artist || "";
    modalAlbumEl.value = track.album || "";
    modalYearEl.value = track.year || "";
    modalOriginEl.value = track.origin || "Manual";
    modalTagsEl.value = (track.tags || []).join(", ");
    modalNotesEl.value = track.notes || "";
    setStarRating("modal-star-rating", track.rating || 0);
  } else {
    modalLabel.textContent = "Add New Track";
    modalIdEl.value = "";
    modalTitleEl.value = "";
    modalArtistEl.value = "";
    modalAlbumEl.value = "";
    modalYearEl.value = "";
    modalOriginEl.value = "Manual";
    modalTagsEl.value = "";
    modalNotesEl.value = "";
    setStarRating("modal-star-rating", 0);
  }

  if (trackModalInstance) {
    trackModalInstance.show();
  }
}

function handleModalSave() {
  const title = document.getElementById("modal-track-title").value.trim();
  const artist = document.getElementById("modal-track-artist").value.trim();
  if (!title || !artist) {
    alert("Title and Artist are required.");
    return;
  }

  const existingId = document.getElementById("modal-track-id").value;
  const existingTrack = existingId ? currentLibrary.find((t) => t.id === existingId) : null;
  const id = existingId || ("trk_" + Date.now() + "_" + Math.floor(Math.random() * 1000));
  const createdAt = existingTrack?.createdAt || Date.now();
  const updatedAt = Date.now();

  const album = document.getElementById("modal-track-album").value.trim();
  const year = document.getElementById("modal-track-year").value.trim();
  const origin = document.getElementById("modal-track-origin").value.trim() || "Manual";
  const tags = document.getElementById("modal-track-tags").value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const notes = document.getElementById("modal-track-notes").value.trim();
  const rating = parseInt(document.getElementById("modal-star-rating").getAttribute("data-rating"), 10) || 0;

  const track = {
    id,
    title,
    artist,
    album,
    year,
    origin,
    tags,
    rating,
    notes,
    links: generateSearchLinks(artist, title),
    createdAt: createdAt,
    updatedAt: updatedAt
  };

  saveTrackToLibrary(track);

  if (trackModalInstance) {
    trackModalInstance.hide();
  }
}

function exportLibraryAsJson() {
  const jsonStr = JSON.stringify(currentLibrary, null, 2);
  downloadBlob(jsonStr, "music_library.json", "application/json");
}

function exportLibraryAsCsv() {
  const headers = ["ID", "Title", "Artist", "Album", "Year", "Origin", "Rating", "Tags", "Notes", "CreatedAt", "UpdatedAt"];
  const rows = currentLibrary.map((t) => [
    t.id,
    `"${(t.title || "").replace(/"/g, '""')}"`,
    `"${(t.artist || "").replace(/"/g, '""')}"`,
    `"${(t.album || "").replace(/"/g, '""')}"`,
    t.year || "",
    `"${(t.origin || "").replace(/"/g, '""')}"`,
    t.rating || 0,
    `"${(t.tags || []).join(",")}"`,
    `"${(t.notes || "").replace(/"/g, '""')}"`,
    t.createdAt ? `"${new Date(t.createdAt).toISOString()}"` : "",
    t.updatedAt ? `"${new Date(t.updatedAt).toISOString()}"` : (t.createdAt ? `"${new Date(t.createdAt).toISOString()}"` : "")
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  downloadBlob(csvContent, "music_library.csv", "text/csv");
}

function handleImportJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) {
        throw new Error("Invalid format: expected JSON array of tracks.");
      }

      let addedCount = 0;
      imported.forEach((item) => {
        if (item.title && item.artist) {
          const itemKey = (item.artist + " - " + item.title).toLowerCase();
          const exists = currentLibrary.some(
            (t) => t.id === item.id || (t.artist + " - " + t.title).toLowerCase() === itemKey
          );
          if (!exists) {
            if (!item.id) item.id = "trk_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
            if (!item.createdAt) item.createdAt = Date.now();
            if (!item.updatedAt) item.updatedAt = item.createdAt;
            currentLibrary.push(item);
            addedCount++;
          }
        }
      });

      await chrome.storage.local.set({ musicLibrary: currentLibrary });
      alert(`Import complete! Added ${addedCount} new track(s).`);
      updateLibraryBadge();
      populateTagFilter();
      filterAndRenderLibrary();
    } catch (err) {
      alert("Error parsing JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
}

function downloadBlob(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 3. SPECTACLES & CALENDAR MODULE
function setupEventsModule() {
  const scanBtn = document.getElementById("events-scan-tab-btn");
  const aiScanBtn = document.getElementById("events-ai-scan-btn");
  const openSelectedBtn = document.getElementById("events-open-selected-btn");
  const geminiKeyInput = document.getElementById("gemini-api-key-input");
  const geminiSaveKeyBtn = document.getElementById("gemini-save-key-btn");
  const geminiSavedMsg = document.getElementById("gemini-key-saved-msg");
  const geminiStatusBadge = document.getElementById("gemini-status-badge");
  const targetCalInput = document.getElementById("event-input-calendar");
  const debugToggle = document.getElementById("ai-debug-toggle");
  const debugClearBtn = document.getElementById("ai-debug-clear-btn");

  // Default Calendar ID for "Interesting" agenda
  const DEFAULT_CALENDAR_ID = "";

  // Load saved Gemini API Key & Target Calendar
  chrome.storage.local.get({ geminiApiKey: "", targetCalendarId: DEFAULT_CALENDAR_ID, showAiDebugLog: false }, (res) => {
    const key = res.geminiApiKey || "";
    if (geminiKeyInput) geminiKeyInput.value = key;
    updateGeminiStatusBadge(key);
    
    let savedCal = res.targetCalendarId;
    if (!savedCal || savedCal === "Interesting") savedCal = DEFAULT_CALENDAR_ID;
    if (targetCalInput) targetCalInput.value = savedCal;
    chrome.storage.local.set({ targetCalendarId: savedCal });

    if (debugToggle) {
      debugToggle.checked = Boolean(res.showAiDebugLog);
      toggleDebugConsoleVisibility(debugToggle.checked);
    }
  });

  if (debugToggle) {
    debugToggle.addEventListener("change", () => {
      const isChecked = debugToggle.checked;
      chrome.storage.local.set({ showAiDebugLog: isChecked });
      toggleDebugConsoleVisibility(isChecked);
    });
  }

  if (debugClearBtn) {
    debugClearBtn.addEventListener("click", () => {
      const contentEl = document.getElementById("ai-debug-log-content");
      if (contentEl) contentEl.innerHTML = '<span class="text-muted">Log cleared.</span>';
    });
  }

  if (targetCalInput) {
    targetCalInput.addEventListener("change", () => {
      chrome.storage.local.set({ targetCalendarId: targetCalInput.value.trim() });
    });
  }

  if (geminiSaveKeyBtn) {
    geminiSaveKeyBtn.addEventListener("click", () => {
      const keyVal = geminiKeyInput.value.trim();
      chrome.storage.local.set({ geminiApiKey: keyVal }, () => {
        updateGeminiStatusBadge(keyVal);
        if (geminiSavedMsg) {
          geminiSavedMsg.classList.remove("d-none");
          setTimeout(() => geminiSavedMsg.classList.add("d-none"), 2000);
        }
      });
    });
  }

  if (aiScanBtn) {
    aiScanBtn.addEventListener("click", scanCurrentPageWithGeminiAI);
  }

  if (scanBtn) {
    scanBtn.addEventListener("click", () => scanCurrentPageForDates(false));
  }

  const fullPageBtn = document.getElementById("btn-scan-full-page");
  if (fullPageBtn) {
    fullPageBtn.addEventListener("click", () => scanCurrentPageForDates(true));
  }

  if (openSelectedBtn) {
    openSelectedBtn.addEventListener("click", openSelectedDatesInCalendar);
  }

  setupManualDateFeature();
}

function setupManualDateFeature() {
  const toggleBtn = document.getElementById("btn-toggle-manual-date");
  const closeBtn = document.getElementById("btn-close-manual-date");
  const manualContainer = document.getElementById("manual-date-container");
  const addBtn = document.getElementById("btn-add-manual-date");
  const addOpenBtn = document.getElementById("btn-add-open-manual-date");
  const dateInput = document.getElementById("manual-date-input");
  const timeInput = document.getElementById("manual-time-input");
  const textInput = document.getElementById("manual-text-input");

  if (toggleBtn && manualContainer) {
    toggleBtn.addEventListener("click", () => {
      manualContainer.classList.toggle("d-none");
      if (!manualContainer.classList.contains("d-none")) {
        if (dateInput) dateInput.focus();
      }
    });
  }

  if (closeBtn && manualContainer) {
    closeBtn.addEventListener("click", () => {
      manualContainer.classList.add("d-none");
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const newEvt = parseManualDateInput();
      if (newEvt) {
        if (!detectedEvents.some((e) => e.start.getTime() === newEvt.start.getTime())) {
          detectedEvents.push(newEvt);
          detectedEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
        }
        renderDetectedDates();
        if (textInput) textInput.value = "";
      }
    });
  }

  if (addOpenBtn) {
    addOpenBtn.addEventListener("click", () => {
      const newEvt = parseManualDateInput();
      if (newEvt) {
        if (!detectedEvents.some((e) => e.start.getTime() === newEvt.start.getTime())) {
          detectedEvents.push(newEvt);
          detectedEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
        }
        renderDetectedDates();
        openGoogleCalendarForEvents([newEvt]);
      }
    });
  }

  const handleKeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (addBtn) addBtn.click();
    }
  };

  if (textInput) textInput.addEventListener("keydown", handleKeydown);
  if (dateInput) dateInput.addEventListener("keydown", handleKeydown);
  if (timeInput) timeInput.addEventListener("keydown", handleKeydown);
}

function parseManualDateInput() {
  const dateInput = document.getElementById("manual-date-input");
  const timeInput = document.getElementById("manual-time-input");
  const textInput = document.getElementById("manual-text-input");
  const errorEl = document.getElementById("manual-date-error");

  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("d-none");
  }

  const dateVal = dateInput ? dateInput.value.trim() : "";
  const timeVal = timeInput ? timeInput.value.trim() : "20:00";
  const textVal = textInput ? textInput.value.trim() : "";

  // 1. Check HTML5 date input
  if (dateVal) {
    const parts = dateVal.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);

      let hour = 20;
      let minute = 0;
      if (timeVal) {
        const timeParts = timeVal.split(":");
        if (timeParts.length >= 2) {
          hour = parseInt(timeParts[0], 10) || 20;
          minute = parseInt(timeParts[1], 10) || 0;
        }
      }

      if (year >= 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const startDate = new Date(year, month - 1, day, hour, minute);
        const endDate = new Date(startDate.getTime() + 2 * 3600 * 1000);
        const label = startDate.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
        return {
          id: "evt_manual_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
          label: label,
          start: startDate,
          end: endDate,
          raw: startDate.toISOString()
        };
      }
    }
  }

  // 2. Check free text input with regex parser
  if (textVal) {
    const extracted = extractDatesFromMetadata({ sample: textVal, selection: "" });
    if (extracted && extracted.length > 0) {
      return extracted[0];
    }
  }

  if (errorEl) {
    errorEl.textContent = "Please pick a date or type a valid date (e.g. 16/10/2026 or 16 oct 2026).";
    errorEl.classList.remove("d-none");
  }
  return null;
}

function toggleDebugConsoleVisibility(show) {
  const debugLogContainer = document.getElementById("ai-debug-log-container");
  const debugClearBtn = document.getElementById("ai-debug-clear-btn");
  if (debugLogContainer) {
    if (show) {
      debugLogContainer.classList.remove("d-none");
    } else {
      debugLogContainer.classList.add("d-none");
    }
  }
  if (debugClearBtn) {
    if (show) {
      debugClearBtn.classList.remove("d-none");
    } else {
      debugClearBtn.classList.add("d-none");
    }
  }
}

function logAiTrace(message, type = "info") {
  const contentEl = document.getElementById("ai-debug-log-content");
  const container = document.getElementById("ai-debug-log-container");
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;

  let color = "#a3e635"; // green default
  if (type === "warn") color = "#facc15"; // yellow
  if (type === "err") color = "#f87171"; // red
  if (type === "req") color = "#38bdf8"; // cyan
  if (type === "res") color = "#c084fc"; // purple

  const line = document.createElement("div");
  line.style.color = color;
  line.style.wordBreak = "break-all";
  line.textContent = `[${timeStr}] ${message}`;

  if (contentEl) {
    if (contentEl.textContent === "Waiting for AI request...") {
      contentEl.innerHTML = "";
    }
    contentEl.appendChild(line);
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }
  console.log(`[AI-Trace] [${timeStr}] ${message}`);
}

function updateGeminiStatusBadge(key) {
  const badge = document.getElementById("gemini-status-badge");
  if (!badge) return;
  if (key && key.length > 5) {
    badge.textContent = "AI Ready (Gemini)";
    badge.className = "badge bg-success";
  } else {
    badge.textContent = "Key not configured";
    badge.className = "badge bg-secondary";
  }
}

async function scanCurrentPageWithGeminiAI() {
  const listContainer = document.getElementById("events-list-container");
  const eventTitleInput = document.getElementById("event-input-title");
  const eventLocationInput = document.getElementById("event-input-location");
  const overallStartTime = performance.now();

  const storageRes = await chrome.storage.local.get({ geminiApiKey: "" });
  const apiKey = (storageRes.geminiApiKey || "").trim();

  if (!apiKey) {
    const collapseEl = document.getElementById("gemini-settings-collapse");
    if (collapseEl && window.bootstrap && window.bootstrap.Collapse) {
      bootstrap.Collapse.getOrCreateInstance(collapseEl).show();
    }
    listContainer.innerHTML = `<div class="text-warning small text-center py-2">Please configure your Google Gemini API key above to use AI Smart Scan.</div>`;
    return;
  }

  logAiTrace("Starting AI Smart Scan...", "info");
  listContainer.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Analyzing page with Google Gemini AI...</div>`;

  try {
    const tab = await getTargetTab();
    if (!tab) throw new Error("No active browser webpage detected. Switch to a webpage tab.");

    logAiTrace(`Active Tab: "${(tab.title || "").substring(0, 40)}" (${tab.url || ""})`, "info");

    const isDirectImageUrl = Boolean(tab.url && /\.(jpe?g|png|webp|gif|bmp|avif)(\?.*)?$/i.test(tab.url));

    let pageData = {};
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runSmartPageExtractor,
        args: [false]
      });
      pageData = results?.[0]?.result || {};
    } catch (e) {
      logAiTrace(`Note: Script injection skipped (${e.message})`, "info");
    }

    const hasSelection = Boolean(pageData.selection && pageData.selection.trim().length > 0);
    const textSample = hasSelection ? pageData.selection.trim() : (pageData.sample || "");
    const isImageTarget = Boolean(pageData.isImagePage || isDirectImageUrl);

    let imageObj = null;

    if (isImageTarget && !hasSelection) {
      logAiTrace("Image poster/flyer detected. Extracting image for multimodal Gemini Vision...", "info");
      if (pageData.imageBase64) {
        imageObj = {
          base64: pageData.imageBase64,
          mimeType: pageData.imageMimeType || "image/jpeg"
        };
      } else {
        const targetUrl = pageData.imageUrl || tab.url;
        logAiTrace(`Fetching image from ${targetUrl.substring(0, 70)}...`, "info");
        imageObj = await fetchAndResizeImage(targetUrl);
      }
      const kbSize = Math.round((imageObj.base64.length * 0.75) / 1024);
      logAiTrace(`Image prepared successfully (${kbSize} KB). Multimodal Vision activated.`, "info");
    }

    if (!imageObj && (!textSample || textSample.length < 5)) {
      throw new Error(hasSelection ? "Selected text is too short to analyze." : "No readable text or image found on page.");
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const todayStr = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]} ${currentYear}`;

    let aiPrompt = "";

    if (imageObj) {
      aiPrompt = `You are an expert AI assistant specialized in analyzing event posters, flyers, concert announcements, workshops (stages/cours), and programs from images.
Carefully inspect the provided image and extract all visible details about the event, artists/performers, venue, city, and schedules.
Return ONLY a strict JSON object.

CURRENT REFERENCE DATE: Today is ${todayStr}. Current year is ${currentYear}.

CRITICAL DATE AND UPCOMING YEAR RULES:
1. The event announced on this flyer is an UPCOMING event.
2. If the year is explicitly printed on the flyer, use it.
3. If the year is NOT printed on the flyer (e.g. only "Dimanche 27 septembre" or "20 septembre"):
   - Determine the upcoming year relative to today (${todayStr}):
     * If the month and day have not yet passed in ${currentYear}, use ${currentYear}.
     * If the month and day have already passed in ${currentYear}, use ${currentYear + 1}.
   - NEVER use past years (such as 2020, 2021, etc.)! Flyers found online are for upcoming events.

CRITICAL TIME AND SCHEDULE RULES:
1. Search the ENTIRE image thoroughly for specific times, schedules, and duration.
   - Look for time ranges like "10h - 12h", "10h - 13h", "13h30 - 15h30", "14h", "20h30", "de 10h a 18h", etc.
   - Look inside colored boxes, badges, text banners, and session descriptions.
   - Daytime events, workshops, stages, and courses typically run during morning and afternoon (e.g. 10:00 to 12:00, 13:30 to 15:30).
2. If the flyer lists MULTIPLE sessions, workshops, or time blocks on the same day:
   - Create a distinct entry in "events" for EACH session so the user can select and add them individually to calendar:
     Example for 2 workshops on 27 Sept:
     Session 1: "label": "Danse traditionnelle (10h - 12h)", "session_name": "Danse traditionnelle", "start_iso": "${currentYear}-09-27T10:00:00", "end_iso": "${currentYear}-09-27T12:00:00"
     Session 2: "label": "Doum danse (13h30 - 15h30)", "session_name": "Doum danse", "start_iso": "${currentYear}-09-27T13:30:00", "end_iso": "${currentYear}-09-27T15:30:00"
3. If an explicit time range is given (e.g. "10h - 12h" or "10h - 13h"), you MUST use that exact start hour (10:00:00) and end hour (12:00:00 or 13:00:00).
4. NEVER default to 20:00:00 when an actual time (such as 10h, 13h30, 14h, etc.) is visible anywhere on the flyer! Only default to 20:00:00 if absolutely no time of day is mentioned anywhere.

PAGE TITLE (context): ${pageData.title || tab.title || ""}
PAGE URL: ${tab.url || ""}

REQUIREMENTS:
1. "event_type": Type of event: "Stage", "Danse", "Concert", "Theatre", "Opera", "Comedy", "Conference", "Festival", "Exposition", or "Spectacle".
2. "event_title": Short clean title formatted according to event type:
   - Concert/Music: "<Artist/Band> / <City>" (NEVER prefix with "Concert", start directly with artist or band name)
   - Workshop/Stage: "Stage <Discipline/Theme> : <Artist/Teacher> / <City>" (e.g. "Stage Danse : Medson Coulibaly / Fontaine")
   - Dance/Ballet: "Danse : <Show/Artist> / <City>"
   - Theater/Play: "Theatre : <Play Name> / <City>"
   - Comedy: "Spectacle <Artist> / <City>"
   - Conference: "Conference : <Title> / <City>"
   - Festival: "Festival <Name> / <City>"
   - Generic/Other: "<Show/Event Name> / <City>"
   MAXIMUM 50 characters. NEVER include pricing, ticket categories, or boilerplate.
3. "artist": Name of the main artist, teacher, performer, band, or speaker (e.g. "Medson Coulibaly").
4. "venue": Specific venue or hall name (e.g. "Salle Emile Bert", "Zehntscheuer", "La Source").
5. "city": City or town name (e.g. "Fontaine", "Ravensburg", "Paris").
6. "location": Combined concise string, e.g. "Fontaine (Salle Emile Bert)".
7. "events": Array of all performance or workshop sessions found. For each:
   - "label": Clear readable label (e.g. "Dimanche 27 sept - Danse traditionnelle (10h - 12h)").
   - "session_name": Specific session or workshop name if applicable (e.g. "Danse traditionnelle", "Doum danse").
   - "start_iso": Local datetime in ISO 8601 format: "YYYY-MM-DDTHH:mm:ss".
   - "end_iso": Local datetime in ISO 8601 format: "YYYY-MM-DDTHH:mm:ss".

JSON FORMAT:
{
  "event_type": "string",
  "event_title": "string",
  "artist": "string",
  "venue": "string",
  "city": "string",
  "location": "string",
  "events": [
    {
      "label": "string",
      "session_name": "string",
      "start_iso": "string",
      "end_iso": "string"
    }
  ]
}`;
    } else {
      logAiTrace(hasSelection
        ? `Active selection detected (${textSample.length} characters). Focusing AI on selection...`
        : `DOM extracted: text sample size = ${textSample.length} characters.`, "info");

      const compactText = textSample.substring(0, 8000).replace(/[ \t]+/g, " ");

      let promptContext = "";
      if (hasSelection) {
        promptContext = `IMPORTANT INSTRUCTION: The user has selected a specific text section on the page.
You MUST focus EXCLUSIVELY on the event, performer, title, venue, and dates described in this SELECTED TEXT.
Do not use generic page titles if this selection contains an event title or artist.

PAGE TITLE (context only): ${pageData.title || tab.title || ""}
PAGE URL (context only): ${tab.url || ""}
SELECTED TEXT (FOCUS TARGET):
"""
${compactText}
"""`;
      } else {
        promptContext = `PAGE TITLE: ${pageData.title || tab.title || ""}
PAGE URL: ${tab.url || ""}
PAGE CONTENT:
"""
${compactText}
"""`;
      }

      aiPrompt = `You are an expert AI assistant that parses concert, theater, spectacles, workshops, and events from web pages.
Extract the exact details from the following web page content and return ONLY a strict JSON object.

CURRENT REFERENCE DATE: Today is ${todayStr}. Current year is ${currentYear}.

CRITICAL DATE AND UPCOMING YEAR RULES:
- The event being parsed is an UPCOMING event.
- If the year is explicitly written on the page, use it.
- If the year is NOT written on the page (e.g. only "27 septembre" or "20 septembre"):
  * If the month and day have not yet passed in ${currentYear}, use ${currentYear}.
  * If the month and day have already passed in ${currentYear}, use ${currentYear + 1}.
  * NEVER use a past year (such as 2020, 2021, etc.).

CRITICAL TIME AND SCHEDULE RULES:
- Search carefully for specific times and schedules (e.g. "10h - 12h", "10h - 13h", "13h30 - 15h30", "14h", "20h30").
- Morning and afternoon events typically run during daytime (e.g. 10:00, 13:30, 14:00).
- If multiple sessions or workshops are mentioned on the same day, create a separate entry in "events" for each session.
- If an exact start and end hour are indicated (e.g. "10h - 12h" or "10h - 13h"), use that exact start hour (10:00:00) and end hour (12:00:00 or 13:00:00).
- ONLY default to 20:00:00 if absolutely no time or schedule is mentioned anywhere.

${promptContext}

REQUIREMENTS:
1. "event_type": Type of event: "Stage", "Danse", "Concert", "Theatre", "Opera", "Comedy", "Conference", "Festival", "Exposition", or "Spectacle".
2. "event_title": Short clean title formatted according to the event type:
   - Concert/Music: "<Artist/Band> / <City>" (NEVER prefix with "Concert", start directly with the artist or band name)
   - Workshop/Stage: "Stage <Discipline/Theme> : <Artist/Teacher> / <City>" (e.g. "Stage Danse : Medson Coulibaly / Fontaine")
   - Dance/Ballet: "Danse : <Show Name> / <City>"
   - Theater/Play: "Theatre : <Play Name> / <City>" (or "<Play Name> / <City>")
   - Opera: "Opera : <Opera Name> / <City>"
   - Comedy: "Spectacle <Artist> / <City>"
   - Conference: "Conference : <Title> / <City>"
   - Festival: "Festival <Name> / <City>"
   - Generic/Other: "<Show/Event Name> / <City>"
   MAXIMUM 50 characters. NEVER include pricing, ticket categories (e.g. Assis/Debout), discounts, TVA, or boilerplate.
3. "artist": Short name of the main performer, teacher, playwright, author, band, or show title.
4. "venue": Specific venue or hall name (e.g. "Salle Emile Bert", "La Source - Grande Salle").
5. "city": City or town name (e.g. "Fontaine", "Paris").
6. "location": Combined concise string, e.g. "Fontaine (Salle Emile Bert)". NEVER include prices or ticket text.
7. "events": Array of all performance or workshop sessions found. For each:
   - "label": Readable date (e.g. "dim. 27 septembre 2026 (10h - 12h)").
   - "session_name": Specific session or workshop name if applicable (e.g. "Danse traditionnelle", "Doum danse").
   - "start_iso": Exact local datetime in ISO 8601 format: "YYYY-MM-DDTHH:mm:ss".
   - "end_iso": Exact local end datetime in ISO 8601 format: "YYYY-MM-DDTHH:mm:ss".

JSON FORMAT:
{
  "event_type": "string",
  "event_title": "string",
  "artist": "string",
  "venue": "string",
  "city": "string",
  "location": "string",
  "events": [
    {
      "label": "string",
      "session_name": "string",
      "start_iso": "string",
      "end_iso": "string"
    }
  ]
}`;
    }

    // 1. Check if we already have a cached working model
    const { lastWorkingGeminiModel } = await chrome.storage.local.get({ lastWorkingGeminiModel: "" });
    let aiResponse = null;
    let successfulModel = null;

    if (lastWorkingGeminiModel) {
      logAiTrace(`Trying cached model: ${lastWorkingGeminiModel}...`, "info");
      aiResponse = await callGeminiApi(apiKey, lastWorkingGeminiModel, aiPrompt, 1, imageObj);
      if (aiResponse) {
        successfulModel = lastWorkingGeminiModel;
      }
    }

    // 2. If no cached model worked, discover and iterate candidates
    if (!aiResponse) {
      logAiTrace("Discovering available Gemini models on account...", "info");
      let candidateModels = await getAllAvailableGeminiModels(apiKey);
      if (!candidateModels || candidateModels.length === 0) {
        candidateModels = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"];
      }
      logAiTrace(`Candidates to try: ${candidateModels.join(", ")}`, "info");

      for (const model of candidateModels) {
        if (model === lastWorkingGeminiModel) continue;
        aiResponse = await callGeminiApi(apiKey, model, aiPrompt, 1, imageObj);
        if (aiResponse) {
          successfulModel = model;
          break;
        }
      }
    }

    if (successfulModel) {
      chrome.storage.local.set({ lastWorkingGeminiModel: successfulModel });
      logAiTrace(`Model ${successfulModel} validated and cached.`, "info");
    }

    if (!aiResponse) {
      logAiTrace("All Gemini model requests failed or timed out.", "err");
      throw new Error("Gemini API is currently busy. Please retry in a moment.");
    }

    const aiData = JSON.parse(aiResponse);

    if (aiData.event_title) {
      let cleanTitle = aiData.event_title.trim();
      const isConcert = (aiData.event_type && aiData.event_type.toLowerCase().includes("concert")) || /^concert\b/i.test(cleanTitle);
      if (isConcert) {
        cleanTitle = cleanTitle.replace(/^concert\s*[:\-]?\s*/i, "").trim();
      }
      eventTitleInput.value = cleanTitle;
    }
    if (aiData.location) eventLocationInput.value = aiData.location;

    detectedEvents = [];
    let eventIdx = 0;

    if (Array.isArray(aiData.events) && aiData.events.length > 0) {
      aiData.events.forEach((evt) => {
        try {
          const resolved = resolveUpcomingEventDate(evt.start_iso, evt.end_iso);
          if (resolved) {
            const startDate = resolved.start;
            const endDate = resolved.end;
            const sessionName = (evt.session_name || "").trim();

            const formattedDate = startDate.toLocaleDateString("fr-FR", {
              weekday: "short",
              day: "numeric",
              month: "long",
              year: "numeric"
            });
            const startTimeStr = startDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            const endTimeStr = endDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

            let label = evt.label || formattedDate;
            if (sessionName && !label.toLowerCase().includes(sessionName.toLowerCase())) {
              label = `${label} - ${sessionName}`;
            }

            detectedEvents.push({
              id: "evt_ai_" + eventIdx++,
              label: label,
              sessionName: sessionName,
              start: startDate,
              end: endDate,
              raw: evt.start_iso
            });
          }
        } catch (e) {}
      });
    }

    if (detectedEvents.length === 0) {
      detectedEvents = extractDatesFromMetadata(pageData);
    }

    renderDetectedDates();

    const totalDuration = Math.round(performance.now() - overallStartTime);
    logAiTrace(`Success in ${totalDuration}ms: Title="${aiData.event_title || ""}", Venue="${aiData.location || ""}", Dates=${detectedEvents.length}`, "info");
  } catch (err) {
    const totalDuration = Math.round(performance.now() - overallStartTime);
    logAiTrace(`Error after ${totalDuration}ms: ${err.message}`, "err");
    listContainer.innerHTML = `<div class="text-danger small text-center py-2">AI Scan Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function getAllAvailableGeminiModels(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) return [];
    const data = await res.json();
    const models = data.models || [];
    
    // Filter for generateContent models and exclude TTS/audio/embeddings/robotics
    const contentModels = models.filter((m) => {
      const name = (m.name || "").toLowerCase();
      const isSupported = Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent");
      const isSpecialized = name.includes("tts") || name.includes("embedding") || name.includes("imagen") || name.includes("aqa") || name.includes("robotics");
      return isSupported && !isSpecialized;
    });

    // Sort: flash models first, then general models
    const flashList = contentModels
      .filter((m) => m.name.toLowerCase().includes("flash"))
      .map((m) => m.name.replace(/^models\//, ""));

    const otherList = contentModels
      .filter((m) => !m.name.toLowerCase().includes("flash"))
      .map((m) => m.name.replace(/^models\//, ""));

    return [...flashList, ...otherList];
  } catch (e) {
    return [];
  }
}

async function fetchAndResizeImage(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  const blob = await res.blob();
  const mimeType = blob.type || "image/jpeg";

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const maxDim = 1600;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({
          base64: dataUrl.split(",")[1],
          mimeType: "image/jpeg"
        });
      } catch (e) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          resolve({
            base64: dataUrl.split(",")[1],
            mimeType: mimeType
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        resolve({
          base64: dataUrl.split(",")[1],
          mimeType: mimeType
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    };
    img.src = objectUrl;
  });
}

async function callGeminiApi(apiKey, modelName, promptText, maxRetries = 2, imageObj = null) {
  const cleanModel = modelName.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

  const parts = [];
  if (imageObj && imageObj.base64) {
    parts.push({
      inlineData: {
        mimeType: imageObj.mimeType || "image/jpeg",
        data: imageObj.base64
      }
    });
  }
  parts.push({ text: promptText });

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: parts
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1
    }
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const startTime = performance.now();
    try {
      logAiTrace(`POST /models/${cleanModel}:generateContent (attempt ${attempt + 1}/${maxRetries})${imageObj ? " [Vision]" : ""}...`, "req");

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const elapsed = Math.round(performance.now() - startTime);

      if (response.ok) {
        const json = await response.json();
        const textContent = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textContent) {
          logAiTrace(`HTTP 200 OK from ${cleanModel} in ${elapsed}ms (${textContent.length} chars).`, "res");
          return textContent.trim();
        }
      }

      const status = response.status;
      const errText = await response.text();
      logAiTrace(`HTTP ${status} from ${cleanModel} in ${elapsed}ms: ${errText.substring(0, 100)}...`, status === 503 || status === 429 ? "warn" : "err");

      // If 503 or 429, wait 1.2 second and retry
      if ((status === 503 || status === 429) && attempt < maxRetries - 1) {
        logAiTrace(`Retrying ${cleanModel} in 1200ms (high demand)...`, "warn");
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }

      // If 404 or other client error, don't retry this model
      break;
    } catch (e) {
      const elapsed = Math.round(performance.now() - startTime);
      logAiTrace(`Fetch error for ${cleanModel} in ${elapsed}ms: ${e.message}`, "err");
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }

  return null;
}

async function scanCurrentPageForDates(forceFullPage = false) {
  const listContainer = document.getElementById("events-list-container");
  const eventTitleInput = document.getElementById("event-input-title");
  const eventLocationInput = document.getElementById("event-input-location");

  const scanLabel = forceFullPage ? "page" : "selection/page";
  listContainer.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Scanning ${scanLabel}...</div>`;

  try {
    const tab = await getTargetTab();
    if (!tab) throw new Error("No active browser webpage detected. Switch to a webpage tab.");

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runSmartPageExtractor,
      args: [Boolean(forceFullPage)]
    });

    const pageData = results?.[0]?.result || {};
    updateSelectionBanner(pageData.selection, forceFullPage);

    // 1. Fill Event Title and Location
    if (pageData.formattedTitle) {
      eventTitleInput.value = pageData.formattedTitle;
    } else if (pageData.title && (!eventTitleInput.value || eventTitleInput.value.startsWith("www."))) {
      eventTitleInput.value = pageData.title;
    }

    if (pageData.location) {
      eventLocationInput.value = pageData.location;
    }

    // 2. Extract Dates with structured data and text regex
    detectedEvents = extractDatesFromMetadata(pageData);
    renderDetectedDates();
  } catch (err) {
    listContainer.innerHTML = `<div class="text-danger small text-center py-2">Could not scan page: ${escapeHtml(err.message)}</div>`;
  }
}

// Function injected into the active page DOM
function runSmartPageExtractor(forceIgnoreSelection = false) {
  const data = {
    title: "",
    artist: "",
    venue: "",
    city: "",
    location: "",
    formattedTitle: "",
    structuredDates: [],
    sample: "",
    selection: "",
    isImagePage: false,
    imageUrl: "",
    imageBase64: null,
    imageMimeType: "image/jpeg"
  };

  let sel = "";
  if (!forceIgnoreSelection) {
    if (window.getSelection()) {
      sel = window.getSelection().toString().trim();
    }
    if (!sel && document.activeElement && typeof document.activeElement.selectionStart === "number") {
      sel = document.activeElement.value.substring(document.activeElement.selectionStart, document.activeElement.selectionEnd).trim();
    }
  }
  data.selection = sel;

  const isGarbage = (text) => {
    if (!text || typeof text !== "string") return true;
    const t = text.toLowerCase();
    const forbidden = [
      "eur", "tarif", "billet", "categorie", "mixte", "assis", "debout",
      "tva", "frais", "panier", "choix des places", "chomeur", "aah", "senior",
      "etudiant", "jeune", "presente par", "producteur"
    ];
    return forbidden.some((f) => t.includes(f)) || text.length > 70 || text.includes("\n");
  };

  const cleanLeafText = (el) => {
    if (!el) return "";
    const txt = (el.innerText || el.textContent || "").trim();
    if (isGarbage(txt)) return "";
    return txt.replace(/\s+/g, " ");
  };

  // 1. Check Schema.org JSON-LD scripts for structured Event
  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  ldScripts.forEach((script) => {
    try {
      const parsed = JSON.parse(script.textContent);
      const items = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
      items.forEach((item) => {
        if (item && (item["@type"] === "Event" || item["@type"] === "MusicEvent" || item["@type"] === "TheaterEvent" || (typeof item["@type"] === "string" && item["@type"].includes("Event")))) {
          if (item.name && !data.title) data.title = item.name.trim();
          if (item.startDate) {
            data.structuredDates.push({
              start: item.startDate,
              end: item.endDate,
              name: item.name
            });
          }
          if (item.performer) {
            const perf = Array.isArray(item.performer) ? item.performer[0] : item.performer;
            const perfName = typeof perf === "string" ? perf : perf?.name;
            if (perfName && !data.artist) data.artist = perfName.trim();
          }
          if (item.location) {
            const locName = item.location.name ? item.location.name.trim() : "";
            const addr = item.location.address || {};
            const locality = addr.addressLocality ? addr.addressLocality.trim() : "";
            if (locality && !isGarbage(locality)) data.city = locality;
            if (locName && !isGarbage(locName)) data.venue = locName;
            if (data.city && data.venue && !data.venue.toLowerCase().includes(data.city.toLowerCase())) {
              data.location = `${data.city} (${data.venue})`;
            } else {
              data.location = data.venue || data.city;
            }
          }
        }
      });
    } catch (e) {}
  });

  // Filter structured dates if there is an active selection
  if (sel.length > 0) {
    data.structuredDates = data.structuredDates.filter((sd) => {
      if (sd.name && sel.toLowerCase().includes(sd.name.toLowerCase())) return true;
      if (sd.start) {
        const datePart = sd.start.split("T")[0];
        const parts = datePart.split("-");
        const altDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : "";
        if (sel.includes(datePart) || (altDate && sel.includes(altDate))) return true;
      }
      return false;
    });
  }

  // 2. Open Graph & Meta tags
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
  const metaTitle = document.querySelector('meta[name="title"]')?.getAttribute("content");

  // 3. Headings & Leaf Selectors
  const h1El = document.querySelector("h1");
  const h1 = cleanLeafText(h1El);

  const eventTitleEl = document.querySelector('h1, [class*="event-title"], [class*="eventTitle"], [class*="eventName"], [class*="show-title"]');
  const cleanTitleFromDom = cleanLeafText(eventTitleEl);

  const artistEl = document.querySelector('[class*="artist-name"], [class*="artistName"], [class*="headliner"]');
  const cleanArtistFromDom = cleanLeafText(artistEl);

  const venueEl = document.querySelector('[class*="venue-name"], [class*="venueName"], [class*="hall-name"]');
  const cleanVenueFromDom = cleanLeafText(venueEl);

  const cityEl = document.querySelector('[class*="city-name"], [class*="cityName"], [class*="locality"]');
  const cleanCityFromDom = cleanLeafText(cityEl);

  if (!data.title) {
    data.title = cleanTitleFromDom || h1 || ogTitle || metaTitle || document.title || "";
  }
  if (!data.artist && cleanArtistFromDom) {
    data.artist = cleanArtistFromDom;
  }
  if (!data.city && cleanCityFromDom) {
    data.city = cleanCityFromDom;
  }
  if (!data.venue && cleanVenueFromDom) {
    data.venue = cleanVenueFromDom;
  }

  // 4. Clean Text Pattern Search for "FONTAINE | La Source - Grande Salle"
  const bodyText = (document.body.innerText || "").substring(0, 30000);
  if (!data.location || isGarbage(data.location)) {
    const locMatch = bodyText.match(/\b([A-Z\s\-]{3,25})\s*\|\s*([A-Za-z0-9\s\-\u2013\u2014\(\)]{3,45})/);
    if (locMatch) {
      const c = locMatch[1].trim();
      const v = locMatch[2].trim();
      if (!isGarbage(c) && !isGarbage(v)) {
        data.city = c;
        data.venue = v;
        data.location = `${c} (${v})`;
      }
    }
  }

  // Compose location if not set
  if (!data.location || isGarbage(data.location)) {
    if (data.city && data.venue && !data.venue.toLowerCase().includes(data.city.toLowerCase())) {
      data.location = `${data.city} (${data.venue})`;
    } else if (data.venue && !isGarbage(data.venue)) {
      data.location = data.venue;
    } else if (data.city && !isGarbage(data.city)) {
      data.location = data.city;
    } else {
      data.location = "";
    }
  }

  // If there is an active text selection, extract title/venue from it
  if (sel.length > 0) {
    const textWithoutDates = sel
      .replace(/(?:du\s+)?\d{1,2}\s+(?:au\s+\d{1,2}\s+)?[a-zA-Z\u00C0-\u017F]+(?:\s+\d{4})?/gi, "")
      .replace(/\b\d{1,2}[\/\.-]\d{1,2}(?:[\/\.-]\d{2,4})?\b/g, "")
      .replace(/\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b/g, "")
      .replace(/(?:[\|\-,\u2013\u2014/:]|at|vers)?\s*\d{1,2}[h:]\d{2}\b/gi, "")
      .replace(/\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lun|mar|mer|jeu|ven|sam|dim)\b/gi, "")
      .replace(/\b(?:billetterie|billet|tickets|reserver|reservation|tarifs?|places?)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const cleanRemainder = textWithoutDates
      .replace(/^[\s\-\u2013\u2014|/\u2022:,]+|[\s\-\u2013\u2014|/\u2022:,]+$/g, "")
      .trim();

    if (cleanRemainder.length >= 3 && cleanRemainder.length <= 120 && !isGarbage(cleanRemainder)) {
      const parts = cleanRemainder.split(/\s*[\-\u2013\u2014|/\u2022]\s*/).filter(Boolean);
      if (parts.length >= 2) {
        data.title = parts[0].trim().replace(/^concert\s*[:\-]?\s*/i, "");
        data.artist = data.title;
        data.location = parts.slice(1).join(" - ").trim();
      } else {
        data.title = cleanRemainder.replace(/^concert\s*[:\-]?\s*/i, "");
        data.artist = data.title;
      }
    }
  }

  // 5. Clean up title from platform boilerplates
  if (data.title) {
    data.title = data.title
      .replace(/\s*[\-\u2013|\u2022:]\s*(?:Billetterie|Tickets|Billeterie|Ticketmaster|Eventim|Fnac Spectacles|Shotgun|Dice|BilletReduc|Digitick|Seetickets|See Tickets|France Billet|Official Site|Site Officiel|Reservation|Achat de billets|Apercu|Tournee|Tour).*$/i, "")
      .replace(/^www\.[a-z0-9\-]+\.[a-z]{2,4}\s*[\-\u2013|:]\s*/i, "")
      .trim();
  }

  // URL fallback slug if title is bad
  if (!data.title || data.title.startsWith("www.") || data.title.includes("http") || isGarbage(data.title)) {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const slug = parts.find((p) => p.includes("-") && !/^\d+$/.test(p));
    if (slug) {
      const words = slug.replace(/-\d+$/, "").replace(/[-_]/g, " ");
      data.title = words.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  // 6. Detect event category dynamically
  const lowerContext = (data.title + " " + data.artist + " " + window.location.href + " " + (sel.length > 0 ? sel : bodyText.substring(0, 4000))).toLowerCase();
  let prefix = "";
  if (lowerContext.includes("theatre") || lowerContext.includes("piece de theatre") || lowerContext.includes("comedie-francaise")) {
    prefix = "Theatre : ";
  } else if (lowerContext.includes("opera")) {
    prefix = "Opera : ";
  } else if (lowerContext.includes("ballet") || lowerContext.includes("danse contemporaine") || lowerContext.includes("choregraphie")) {
    prefix = "Danse : ";
  } else if (lowerContext.includes("humour") || lowerContext.includes("stand up") || lowerContext.includes("stand-up") || lowerContext.includes("one man show") || lowerContext.includes("one woman show")) {
    prefix = "Spectacle ";
  } else if (lowerContext.includes("expo") || lowerContext.includes("exposition")) {
    prefix = "Expo ";
  } else if (lowerContext.includes("festival")) {
    prefix = "Festival ";
  } else if (lowerContext.includes("conference") || lowerContext.includes("debat")) {
    prefix = "Conference : ";
  } else if (lowerContext.includes("concert") || lowerContext.includes("musique") || lowerContext.includes("album") || lowerContext.includes("tournee") || lowerContext.includes("live") || lowerContext.includes("orchestre")) {
    // For concerts, do not prefix with "Concert", start directly with artist name
    prefix = "";
  }

  // 7. Build clean smart title
  let mainSubject = data.artist || data.title || "Spectacle";
  mainSubject = mainSubject.replace(/^(?:Concert|Spectacle|Festival|Theatre|Opera|Danse|Expo|Conference)\s*[:\-]?\s*/i, "").trim();
  const cleanCity = data.city && !isGarbage(data.city) ? data.city : "";

  if (cleanCity) {
    data.formattedTitle = `${prefix}${mainSubject} / ${cleanCity}`;
  } else if (data.location && !isGarbage(data.location) && data.location.length < 35) {
    data.formattedTitle = `${prefix}${mainSubject} / ${data.location}`;
  } else {
    data.formattedTitle = `${prefix}${mainSubject}`;
  }

  data.sample = sel.length > 0 ? sel : bodyText;

  // 8. Image Flyer / Poster Detection
  let isImagePage = false;
  let imageUrl = "";
  let imageBase64 = null;
  let imageMimeType = "image/jpeg";

  if (document.contentType && document.contentType.startsWith("image/")) {
    isImagePage = true;
    imageUrl = window.location.href;
  } else if (document.images && document.images.length === 1 && (!bodyText || bodyText.trim().length < 50)) {
    isImagePage = true;
    imageUrl = document.images[0].src || window.location.href;
  } else if ((!bodyText || bodyText.trim().length < 250) && document.images && document.images.length > 0) {
    let bestImg = null;
    let maxArea = 0;
    for (let i = 0; i < document.images.length; i++) {
      const im = document.images[i];
      const area = (im.naturalWidth || im.width || 0) * (im.naturalHeight || im.height || 0);
      if (area > maxArea && (im.naturalWidth >= 200 || im.width >= 200)) {
        maxArea = area;
        bestImg = im;
      }
    }
    if (bestImg) {
      isImagePage = true;
      imageUrl = bestImg.src;
    }
  }

  if (isImagePage && document.images && document.images.length > 0) {
    const targetImg = document.querySelector("img");
    if (targetImg && targetImg.complete && targetImg.naturalWidth > 0) {
      try {
        const maxDim = 1600;
        let w = targetImg.naturalWidth || targetImg.width || 800;
        let h = targetImg.naturalHeight || targetImg.height || 600;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(targetImg, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        imageBase64 = dataUrl.split(",")[1];
        imageMimeType = "image/jpeg";
      } catch (e) {
        // Tainted canvas by CORS, popup fetch will be used as fallback
      }
    }
  }

  data.isImagePage = isImagePage;
  data.imageUrl = imageUrl || window.location.href;
  data.imageBase64 = imageBase64;
  data.imageMimeType = imageMimeType;

  return data;
}

const MONTH_MAP = {
  janvier: 1, janv: 1, jan: 1,
  fevrier: 2, fevr: 2, feb: 2,
  mars: 3, mar: 3,
  avril: 4, avr: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6,
  juillet: 7, juil: 7, jul: 7,
  aout: 8, aou: 8, aug: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, dec: 12
};

function resolveUpcomingEventDate(rawStartDate, rawEndDate) {
  const now = new Date();
  const currentYear = now.getFullYear();

  let start = new Date(rawStartDate);
  if (isNaN(start.getTime())) return null;

  let end = rawEndDate ? new Date(rawEndDate) : null;
  if (!end || isNaN(end.getTime())) {
    end = new Date(start.getTime() + 2 * 3600 * 1000);
  }

  // If parsed year is in the past (e.g. 2020), adjust to current or next upcoming year
  if (start.getFullYear() < currentYear) {
    let targetYear = currentYear;
    // Check if this date has already passed this year (with 7 days margin for ongoing events)
    const testDate = new Date(currentYear, start.getMonth(), start.getDate(), start.getHours(), start.getMinutes());
    if (testDate.getTime() < (now.getTime() - 7 * 86400 * 1000)) {
      targetYear = currentYear + 1;
    }
    const yearDiff = targetYear - start.getFullYear();
    start.setFullYear(targetYear);
    if (end) {
      end.setFullYear(end.getFullYear() + yearDiff);
    }
  }

  return { start, end };
}

function extractDatesFromMetadata(pageData) {
  const currentYear = new Date().getFullYear();
  const events = [];
  let eventIdx = 0;

  const hasSelection = Boolean(pageData.selection && pageData.selection.trim().length > 0);
  const selectionText = hasSelection ? pageData.selection.trim() : "";

  // 1. Structured JSON-LD Dates (100% precise)
  if (pageData.structuredDates && pageData.structuredDates.length > 0) {
    const datesToProcess = hasSelection
      ? pageData.structuredDates.filter((sd) => {
          if (!sd.start) return false;
          const datePart = sd.start.split("T")[0];
          const parts = datePart.split("-");
          const altDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : "";
          const nameMatch = sd.name && selectionText.toLowerCase().includes(sd.name.toLowerCase());
          const dateMatch = selectionText.includes(datePart) || (altDate && selectionText.includes(altDate));
          return nameMatch || dateMatch;
        })
      : pageData.structuredDates;

    datesToProcess.forEach((sd) => {
      try {
        const resolved = resolveUpcomingEventDate(sd.start, sd.end);
        if (resolved) {
          const start = resolved.start;
          const end = resolved.end;
          const label = start.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
          events.push({
            id: "evt_" + eventIdx++,
            label: label,
            start: start,
            end: end,
            raw: sd.start
          });
        }
      } catch (e) {}
    });
  }

  // 2. Text Regex Extraction
  // When a selection is present, we focus STRICTLY on the selected text
  const rawText = hasSelection ? selectionText : (pageData.sample || "");
  const text = rawText.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const rangePattern = /(?:du\s+)?(\d{1,2})\s+(?:au\s+(\d{1,2})\s+)?([a-zA-Z]+)(?:\s+(\d{4}))?(?:(?:\s*[\|\-,\u2013\u2014/:]\s*|\s+(?:a|at|vers|des)\s*|\s+)(\d{1,2})[h:](\d{2})?)?/gi;
  const numericPattern = /\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{2,4}))?(?:(?:\s*[\|\-,\u2013\u2014/:]\s*|\s+(?:a|at|vers|des)\s*|\s+)(\d{1,2})[h:](\d{2})?)?\b/g;
  const isoPattern = /\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s](\d{1,2})[h:](\d{2}))?\b/g;

  let match;

  while ((match = rangePattern.exec(text)) !== null) {
    const startDay = parseInt(match[1], 10);
    const endDay = match[2] ? parseInt(match[2], 10) : null;
    const rawMonth = match[3].toLowerCase();
    const monthNum = MONTH_MAP[rawMonth];

    if (monthNum && startDay >= 1 && startDay <= 31) {
      let rawYear = match[4] ? parseInt(match[4], 10) : currentYear;
      if (!match[4] && monthNum < (new Date().getMonth() + 1)) {
        rawYear = currentYear + 1;
      }

      let hour = match[5] ? parseInt(match[5], 10) : null;
      let minute = match[6] ? parseInt(match[6], 10) : 0;

      if (hour === null) {
        const lookahead = text.substring(match.index + match[0].length, match.index + match[0].length + 30);
        const timeMatch = lookahead.match(/^\s*(?:[\|\-,\u2013\u2014/:]|a|at|vers|des)?\s*(\d{1,2})[h:](\d{2})\b/i);
        if (timeMatch) {
          hour = parseInt(timeMatch[1], 10);
          minute = parseInt(timeMatch[2], 10);
        } else {
          hour = 20;
        }
      }

      const startDate = new Date(rawYear, monthNum - 1, startDay, hour, minute);
      let endDate;
      if (endDay && endDay >= 1 && endDay <= 31) {
        endDate = new Date(rawYear, monthNum - 1, endDay, hour + 2, minute);
      } else {
        endDate = new Date(rawYear, monthNum - 1, startDay, hour + 2, minute);
      }

      const label = match[0].trim();
      if (!events.some((e) => e.start.getTime() === startDate.getTime())) {
        events.push({
          id: "evt_" + eventIdx++,
          label: label,
          start: startDate,
          end: endDate,
          raw: match[0]
        });
      }
    }
  }

  while ((match = numericPattern.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let year = match[3] ? parseInt(match[3], 10) : currentYear;
      if (year < 100) year += 2000;
      if (!match[3] && month < (new Date().getMonth() + 1)) {
        year = currentYear + 1;
      }

      let hour = match[4] ? parseInt(match[4], 10) : null;
      let minute = match[5] ? parseInt(match[5], 10) : 0;

      if (hour === null) {
        const lookahead = text.substring(match.index + match[0].length, match.index + match[0].length + 30);
        const timeMatch = lookahead.match(/^\s*(?:[\|\-,\u2013\u2014/:]|a|at|vers|des)?\s*(\d{1,2})[h:](\d{2})\b/i);
        if (timeMatch) {
          hour = parseInt(timeMatch[1], 10);
          minute = parseInt(timeMatch[2], 10);
        } else {
          hour = 20;
        }
      }

      const startDate = new Date(year, month - 1, day, hour, minute);
      const endDate = new Date(year, month - 1, day, hour + 2, minute);
      if (!events.some((e) => e.start.getTime() === startDate.getTime())) {
        events.push({
          id: "evt_" + eventIdx++,
          label: match[0].trim(),
          start: startDate,
          end: endDate,
          raw: match[0]
        });
      }
    }
  }

  while ((match = isoPattern.exec(text)) !== null) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    let hour = match[4] ? parseInt(match[4], 10) : 20;
    let minute = match[5] ? parseInt(match[5], 10) : 0;

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const startDate = new Date(year, month - 1, day, hour, minute);
      const endDate = new Date(year, month - 1, day, hour + 2, minute);
      if (!events.some((e) => e.start.getTime() === startDate.getTime())) {
        events.push({
          id: "evt_" + eventIdx++,
          label: match[0].trim(),
          start: startDate,
          end: endDate,
          raw: match[0]
        });
      }
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return events.slice(0, 15);
}

function renderDetectedDates() {
  const container = document.getElementById("events-list-container");
  const openSelectedBtn = document.getElementById("events-open-selected-btn");
  const manualContainer = document.getElementById("manual-date-container");

  if (detectedEvents.length === 0) {
    if (manualContainer) {
      manualContainer.classList.remove("d-none");
    }

    const banner = document.getElementById("selection-focus-banner");
    const hasActiveSelection = banner && !banner.classList.contains("d-none");
    if (hasActiveSelection) {
      container.innerHTML = `<div class="text-muted small text-center py-3">No dates detected in selection. You can enter a date manually above, or click <a href="#" id="events-empty-scan-all" class="text-primary text-decoration-none fw-semibold">Scan full page</a>.</div>`;
      const scanAllLink = document.getElementById("events-empty-scan-all");
      if (scanAllLink) {
        scanAllLink.addEventListener("click", (e) => {
          e.preventDefault();
          scanCurrentPageForDates(true);
        });
      }
    } else {
      container.innerHTML = `<div class="text-muted small text-center py-3">No dates detected automatically. You can enter a date manually above or select text on the page.</div>`;
    }
    openSelectedBtn.disabled = true;
    return;
  }

  openSelectedBtn.disabled = false;
  container.innerHTML = "";

  detectedEvents.forEach((evt) => {
    const item = document.createElement("div");
    item.className = "d-flex align-items-center justify-content-between p-2 border-bottom";

    const formattedDate = evt.start.toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    const startTimeStr = evt.start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const endTimeStr = evt.end ? evt.end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
    const timeDisplay = endTimeStr && endTimeStr !== startTimeStr ? `${startTimeStr} - ${endTimeStr}` : startTimeStr;

    const sessionBadge = evt.sessionName ? `<span class="badge bg-light text-primary border ms-1">${escapeHtml(evt.sessionName)}</span>` : "";

    item.innerHTML = `
      <div class="form-check d-flex align-items-center gap-2 mb-0">
        <input class="form-check-input evt-checkbox" type="checkbox" value="${evt.id}" id="chk-${evt.id}" checked>
        <label class="form-check-label small cursor-pointer" for="chk-${evt.id}">
          <span class="fw-semibold">${formattedDate}</span> <span class="text-muted">(${timeDisplay})</span>${sessionBadge}
        </label>
      </div>
      <button class="btn btn-sm btn-outline-primary py-0 px-2 btn-single-gcal" style="font-size: 0.75rem;">
        Open
      </button>
    `;

    item.querySelector(".btn-single-gcal").addEventListener("click", () => {
      openGoogleCalendarForEvents([evt]);
    });

    container.appendChild(item);
  });
}

function openSelectedDatesInCalendar() {
  const checkboxes = document.querySelectorAll(".evt-checkbox:checked");
  const selectedIds = Array.from(checkboxes).map((c) => c.value);
  const selectedEvents = detectedEvents.filter((e) => selectedIds.includes(e.id));

  if (selectedEvents.length === 0) {
    alert("Please check at least one date.");
    return;
  }

  openGoogleCalendarForEvents(selectedEvents);
}

function openGoogleCalendarForEvents(eventList) {
  const baseTitle = document.getElementById("event-input-title").value.trim() || "Spectacle / Event";
  const location = document.getElementById("event-input-location").value.trim();
  const calendarTarget = document.getElementById("event-input-calendar").value.trim();
  const sourceUrl = activeTabInfo ? activeTabInfo.url : "";

  // Title is clean without any prefix
  const details = `Extracted via My Extras Extension.\nSource: ${sourceUrl}`;

  eventList.forEach((evt) => {
    const startIso = formatGoogleCalendarDate(evt.start);
    const endIso = formatGoogleCalendarDate(evt.end);

    let eventTitle = baseTitle;
    if (evt.sessionName && !eventTitle.toLowerCase().includes(evt.sessionName.toLowerCase())) {
      eventTitle = `${eventTitle} - ${evt.sessionName}`;
    }

    let gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      eventTitle
    )}&dates=${startIso}/${endIso}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;

    // If a target calendar ID is set, target that calendar without adding it as a guest
    if (calendarTarget) {
      gcalUrl += `&src=${encodeURIComponent(calendarTarget)}`;
    }

    chrome.tabs.create({ url: gcalUrl });
  });
}

function formatGoogleCalendarDate(dateObj) {
  const pad = (n) => (n < 10 ? "0" + n : n);
  const year = dateObj.getFullYear();
  const month = pad(dateObj.getMonth() + 1);
  const day = pad(dateObj.getDate());
  const hours = pad(dateObj.getHours());
  const minutes = pad(dateObj.getMinutes());
  const seconds = "00";
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

// 4. BNF PROXY MODULE
function setupBnfModule() {
  const openBtn = document.getElementById("bnf-open-tab-btn");
  const proxyInput = document.getElementById("bnf-proxy-input");
  const saveSettingsBtn = document.getElementById("bnf-save-settings-btn");
  const savedMsg = document.getElementById("bnf-settings-saved");

  // Press Favorites buttons
  const pressButtons = document.querySelectorAll(".bnf-press-btn");
  pressButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetUrl = btn.getAttribute("data-url");
      if (targetUrl) {
        openUrlThroughBnfProxy(targetUrl);
      }
    });
  });

  // Custom bookmarks UI elements
  const addBookmarkToggle = document.getElementById("bnf-add-bookmark-toggle");
  const addBookmarkForm = document.getElementById("bnf-add-bookmark-form");
  const bmTitleInput = document.getElementById("bnf-bm-title-input");
  const bmUrlInput = document.getElementById("bnf-bm-url-input");
  const bmSaveBtn = document.getElementById("bnf-bm-save-btn");
  const bmCancelBtn = document.getElementById("bnf-bm-cancel-btn");

  if (addBookmarkToggle) {
    addBookmarkToggle.addEventListener("click", () => {
      addBookmarkForm.classList.toggle("d-none");
      if (!addBookmarkForm.classList.contains("d-none") && activeTabInfo) {
        if (!bmUrlInput.value) bmUrlInput.value = activeTabInfo.url || "";
        if (!bmTitleInput.value) bmTitleInput.value = activeTabInfo.title || "";
      }
    });
  }

  if (bmCancelBtn) {
    bmCancelBtn.addEventListener("click", () => {
      addBookmarkForm.classList.add("d-none");
    });
  }

  if (bmSaveBtn) {
    bmSaveBtn.addEventListener("click", async () => {
      const title = bmTitleInput.value.trim();
      const url = bmUrlInput.value.trim();
      if (!title || !url) {
        alert("Title and URL are required.");
        return;
      }

      const newBm = {
        id: "bm_" + Date.now(),
        title,
        url,
        createdAt: Date.now()
      };

      const res = await chrome.storage.local.get({ bnfBookmarks: [] });
      const list = res.bnfBookmarks || [];
      list.push(newBm);
      await chrome.storage.local.set({ bnfBookmarks: list });

      bmTitleInput.value = "";
      bmUrlInput.value = "";
      addBookmarkForm.classList.add("d-none");
      loadAndRenderBnfBookmarks();
    });
  }

  // Load saved proxy setting & bookmarks
  chrome.storage.local.get({ bnfProxyTemplate: DEFAULT_BNF_PROXY }, (res) => {
    proxyInput.value = res.bnfProxyTemplate || DEFAULT_BNF_PROXY;
  });

  loadAndRenderBnfBookmarks();

  saveSettingsBtn.addEventListener("click", () => {
    const val = proxyInput.value.trim() || DEFAULT_BNF_PROXY;
    chrome.storage.local.set({ bnfProxyTemplate: val }, () => {
      savedMsg.classList.remove("d-none");
      setTimeout(() => savedMsg.classList.add("d-none"), 2000);
    });
  });

  openBtn.addEventListener("click", () => {
    if (!activeTabInfo || !activeTabInfo.url) {
      alert("No active web page detected.");
      return;
    }
    openUrlThroughBnfProxy(activeTabInfo.url);
  });
}

async function openUrlThroughBnfProxy(targetUrl) {
  const proxyInput = document.getElementById("bnf-proxy-input");
  const template = (proxyInput ? proxyInput.value.trim() : "") || DEFAULT_BNF_PROXY;
  const finalUrl = template.includes("%s")
    ? template.replace("%s", encodeURIComponent(targetUrl))
    : template + encodeURIComponent(targetUrl);

  chrome.tabs.create({ url: finalUrl });
}

async function loadAndRenderBnfBookmarks() {
  const container = document.getElementById("bnf-custom-bookmarks-list");
  const emptyMsg = document.getElementById("bnf-custom-bookmarks-empty");
  if (!container) return;

  const res = await chrome.storage.local.get({ bnfBookmarks: [] });
  const bookmarks = res.bnfBookmarks || [];

  if (bookmarks.length === 0) {
    container.innerHTML = "";
    if (emptyMsg) emptyMsg.classList.remove("d-none");
    return;
  }

  if (emptyMsg) emptyMsg.classList.add("d-none");
  container.innerHTML = "";

  bookmarks.forEach((bm) => {
    const item = document.createElement("div");
    item.className = "list-group-item d-flex justify-content-between align-items-center py-2 px-2";

    item.innerHTML = `
      <div class="min-w-0 flex-grow-1 me-2 cursor-pointer bm-open-link" title="Open ${escapeHtml(bm.url)} via BnF">
        <div class="fw-semibold text-dark text-truncate">${escapeHtml(bm.title)}</div>
        <div class="text-muted text-truncate font-monospace" style="font-size:0.68rem;">${escapeHtml(bm.url)}</div>
      </div>
      <div class="d-flex gap-1 align-items-center flex-shrink-0">
        <button class="btn btn-sm btn-outline-primary py-0 px-2 bm-open-btn" title="Open via BnF" style="font-size:0.75rem;">
          Open
        </button>
        <button class="btn btn-sm btn-outline-danger py-0 px-2 bm-del-btn" title="Delete bookmark" style="font-size:0.75rem;">
          Del
        </button>
      </div>
    `;

    item.querySelector(".bm-open-link").addEventListener("click", () => openUrlThroughBnfProxy(bm.url));
    item.querySelector(".bm-open-btn").addEventListener("click", () => openUrlThroughBnfProxy(bm.url));
    item.querySelector(".bm-del-btn").addEventListener("click", async () => {
      if (confirm(`Remove bookmark "${bm.title}"?`)) {
        const current = await chrome.storage.local.get({ bnfBookmarks: [] });
        const updated = (current.bnfBookmarks || []).filter((b) => b.id !== bm.id);
        await chrome.storage.local.set({ bnfBookmarks: updated });
        loadAndRenderBnfBookmarks();
      }
    });

    container.appendChild(item);
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
