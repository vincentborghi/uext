const FIP_API_URL = 'https://api.radiofrance.fr/livemeta/pull/7';
const FIP_STREAM_URL = 'https://icecast.radiofrance.fr/fip-midfi.mp3';
const DEFAULT_BNF_PROXY = 'https://acces-distant.bnf.fr/login?url=';

let currentFipTrack = null;
let activeTabInfo = null;
let currentLibrary = [];
let detectedEvents = [];
let trackModalInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupStarRatingListeners();
  setupFipModule();
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      activeTabInfo = tab;
      const bnfUrlEl = document.getElementById("bnf-current-url");
      if (bnfUrlEl) {
        bnfUrlEl.textContent = tab.url || "No active URL";
      }

      // Try smart page extraction on the active tab
      if (tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: runSmartPageExtractor
          });
          const pageData = results?.[0]?.result;
          if (pageData) {
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
          }
        } catch (e) {
          // Fallback simple title
          const eventTitleEl = document.getElementById("event-input-title");
          if (eventTitleEl && !eventTitleEl.value && tab.title) {
            const cleanTitle = tab.title.replace(/\s*[-–|].*$/, "").trim();
            eventTitleEl.value = cleanTitle || tab.title;
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to get active tab:", err);
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
    starsHtml += `<span class="${activeClass}">★</span>`;
  }
  return `<span class="star-rating d-inline-flex gap-0" style="font-size:0.9rem;">${starsHtml}</span>`;
}

// 1. FIP LIVE MODULE
function setupFipModule() {
  const refreshBtn = document.getElementById("fip-refresh-btn");
  const saveBtn = document.getElementById("fip-save-library-btn");
  const playBtn = document.getElementById("fip-play-btn");
  const audioEl = document.getElementById("fip-audio-element");

  refreshBtn.addEventListener("click", refreshFipLive);

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

    const trackToSave = {
      id: "trk_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      title: currentFipTrack.title || "Unknown Title",
      artist: currentFipTrack.artist || "Unknown Artist",
      album: currentFipTrack.album || "",
      year: currentFipTrack.year || "",
      origin: "FIP",
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
    alertEl.classList.remove("d-none");
    setTimeout(() => alertEl.classList.add("d-none"), 3000);
  });

  if (playBtn && audioEl) {
    playBtn.addEventListener("click", () => {
      if (audioEl.paused) {
        audioEl.src = FIP_STREAM_URL;
        audioEl.play();
        playBtn.textContent = "Pause FIP";
        playBtn.classList.replace("btn-outline-primary", "btn-danger");
      } else {
        audioEl.pause();
        audioEl.src = "";
        playBtn.textContent = "Play FIP";
        playBtn.classList.replace("btn-danger", "btn-outline-primary");
      }
    });
  }
}

async function refreshFipLive() {
  const loadingEl = document.getElementById("fip-loading");
  const contentEl = document.getElementById("fip-content");
  const titleEl = document.getElementById("fip-title");
  const artistEl = document.getElementById("fip-artist");
  const albumEl = document.getElementById("fip-album");
  const coverEl = document.getElementById("fip-cover");

  try {
    loadingEl.classList.remove("d-none");
    contentEl.classList.add("opacity-50");

    const response = await fetch(FIP_API_URL + "?ts=" + Date.now());
    if (!response.ok) {
      throw new Error("HTTP error " + response.status);
    }

    const data = await response.json();
    const nowTs = Math.floor(Date.now() / 1000);
    const steps = Object.values(data.steps || {});
    
    // Find active song or fallback to latest step
    const songs = steps.filter((s) => s && (s.embedType === "song" || s.title));
    let songData = songs.find((s) => s.start <= nowTs && nowTs <= s.end);
    
    if (!songData && songs.length > 0) {
      songs.sort((a, b) => (b.start || 0) - (a.start || 0));
      songData = songs[0];
    }

    if (!songData) {
      songData = data.now?.song || data.levels?.[0]?.items?.[0] || {};
    }

    const title = songData.title || songData.name || "Unknown Track";
    const artist = songData.authors || songData.performers || (songData.highlightedArtists && songData.highlightedArtists[0]) || songData.artist || "Unknown Artist";
    const album = songData.titreAlbum || songData.album?.title || songData.album || "";
    const year = songData.anneeEditionMusique || songData.releaseYear || songData.year || "";
    const cover = songData.visual || songData.coverUrl || songData.cover?.src || "../icons/icon48.png";

    currentFipTrack = {
      title,
      artist,
      album,
      year,
      coverUrl: cover,
      links: generateSearchLinks(artist, title)
    };

    titleEl.textContent = title;
    artistEl.textContent = artist;
    albumEl.textContent = [album, year].filter(Boolean).join(" • ") || "Single / Album";
    coverEl.src = cover;

    updateSearchLinks("fip-link-", currentFipTrack.links);
  } catch (err) {
    console.warn("Could not fetch FIP live directly:", err);
    titleEl.textContent = "FIP Radio Direct";
    artistEl.textContent = "Live Radio France";
    albumEl.textContent = "Click refresh or open FIP website";
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

  // Load saved Gemini API Key
  chrome.storage.local.get({ geminiApiKey: "" }, (res) => {
    const key = res.geminiApiKey || "";
    if (geminiKeyInput) geminiKeyInput.value = key;
    updateGeminiStatusBadge(key);
  });

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
    scanBtn.addEventListener("click", scanCurrentPageForDates);
  }

  if (openSelectedBtn) {
    openSelectedBtn.addEventListener("click", openSelectedDatesInCalendar);
  }
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

  listContainer.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Analyzing page with Google Gemini AI...</div>`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runSmartPageExtractor
    });

    const pageData = results?.[0]?.result || {};
    const textSample = pageData.sample || "";

    if (!textSample || textSample.length < 10) {
      throw new Error("No readable text found on page.");
    }

    const aiPrompt = `You are an expert AI assistant that parses concert, theater, spectacles, and events from web pages.
Extract the exact details from the following web page and return ONLY a strict JSON object.

PAGE TITLE: ${pageData.title || tab.title || ""}
PAGE URL: ${tab.url || ""}
PAGE CONTENT:
"""
${textSample.substring(0, 16000)}
"""

REQUIREMENTS:
1. "event_title": Short clean title strictly formatted as "Concert <Artist/Show> / <City>". Example: "Concert Rodolphe Burger / Fontaine". MAXIMUM 50 characters. NEVER include pricing, ticket categories (e.g. Assis/Debout), discounts, TVA, or boilerplate.
2. "artist": Short name of the main performer, band, or show title (e.g. "Rodolphe Burger").
3. "venue": Specific venue or hall name (e.g. "La Source - Grande Salle").
4. "city": City or town name (e.g. "Fontaine").
5. "location": Combined concise string, e.g. "Fontaine (La Source - Grande Salle)". NEVER include prices or ticket text.
6. "events": Array of all performance dates and times found on this page. For each event:
   - "label": Readable date (e.g. "jeu. 8 octobre 2026").
   - "start_iso": Exact local datetime in ISO 8601 format: "YYYY-MM-DDTHH:mm:ss" (e.g. "2026-10-08T20:30:00"). If start hour is not specified, default to 20:00:00.
   - "end_iso": Exact local end datetime in ISO 8601 format: "YYYY-MM-DDTHH:mm:ss" (usually start + 2 hours).

JSON FORMAT:
{
  "event_title": "string",
  "artist": "string",
  "venue": "string",
  "city": "string",
  "location": "string",
  "events": [
    {
      "label": "string",
      "start_iso": "string",
      "end_iso": "string"
    }
  ]
}`;

    // Try Gemini 2.0 Flash then 1.5 Flash
    let aiResponse = await callGeminiApi(apiKey, "gemini-2.0-flash", aiPrompt);
    if (!aiResponse) {
      aiResponse = await callGeminiApi(apiKey, "gemini-1.5-flash", aiPrompt);
    }

    if (!aiResponse) {
      throw new Error("Invalid or empty response from Gemini API. Check your API key.");
    }

    const aiData = JSON.parse(aiResponse);

    if (aiData.event_title) eventTitleInput.value = aiData.event_title;
    if (aiData.location) eventLocationInput.value = aiData.location;

    detectedEvents = [];
    let eventIdx = 0;

    if (Array.isArray(aiData.events) && aiData.events.length > 0) {
      aiData.events.forEach((evt) => {
        try {
          const startDate = new Date(evt.start_iso);
          if (!isNaN(startDate.getTime())) {
            let endDate = evt.end_iso ? new Date(evt.end_iso) : null;
            if (!endDate || isNaN(endDate.getTime())) {
              endDate = new Date(startDate.getTime() + 2 * 3600 * 1000);
            }
            const label = evt.label || startDate.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
            detectedEvents.push({
              id: "evt_ai_" + eventIdx++,
              label: label,
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
  } catch (err) {
    listContainer.innerHTML = `<div class="text-danger small text-center py-2">AI Scan Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function callGeminiApi(apiKey, modelName, promptText) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: promptText }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini API error (${modelName}):`, errText);
      return null;
    }

    const json = await response.json();
    const textContent = json.candidates?.[0]?.content?.parts?.[0]?.text;
    return textContent ? textContent.trim() : null;
  } catch (e) {
    console.error(`Gemini API call failed for ${modelName}:`, e);
    return null;
  }
}

async function scanCurrentPageForDates() {
  const listContainer = document.getElementById("events-list-container");
  const eventTitleInput = document.getElementById("event-input-title");
  const eventLocationInput = document.getElementById("event-input-location");

  listContainer.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Scanning page...</div>`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runSmartPageExtractor
    });

    const pageData = results?.[0]?.result || {};

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
function runSmartPageExtractor() {
  const data = {
    title: "",
    artist: "",
    venue: "",
    city: "",
    location: "",
    formattedTitle: "",
    structuredDates: [],
    sample: "",
    selection: ""
  };

  const sel = window.getSelection() ? window.getSelection().toString().trim() : "";
  data.selection = sel;

  const isGarbage = (text) => {
    if (!text || typeof text !== "string") return true;
    const t = text.toLowerCase();
    const forbidden = [
      "€", "eur", "tarif", "billet", "catégorie", "categorie", "mixte", "assis", "debout",
      "tva", "frais", "panier", "choix des places", "chômeur", "chomeur", "aah", "senior",
      "étudiant", "etudiant", "jeune", "présenté par", "presente par", "producteur"
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
    const locMatch = bodyText.match(/\b([A-ZÀ-Ÿ\s\-]{3,25})\s*\|\s*([A-Za-zÀ-ÿ0-9\s\-–\(\)]{3,45})/);
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

  // 5. Clean up title from platform boilerplates
  if (data.title) {
    data.title = data.title
      .replace(/\s*[-–|•:]\s*(?:Billetterie|Tickets|Billeterie|Ticketmaster|Eventim|Fnac Spectacles|Shotgun|Dice|BilletReduc|Digitick|Seetickets|See Tickets|France Billet|Official Site|Site Officiel|Reservation|Achat de billets|Aperçu|Tournée|Tour).*$/i, "")
      .replace(/^www\.[a-z0-9\-]+\.[a-z]{2,4}\s*[-–|:]\s*/i, "")
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

  // 6. Build clean smart title (e.g. "Concert Rodolphe Burger / Fontaine")
  let mainSubject = data.artist || data.title || "Spectacle";
  mainSubject = mainSubject.replace(/^(?:Concert|Spectacle|Festival)\s+/i, "").trim();
  const cleanCity = data.city && !isGarbage(data.city) ? data.city : "";

  if (cleanCity) {
    data.formattedTitle = `Concert ${mainSubject} / ${cleanCity}`;
  } else if (data.location && !isGarbage(data.location) && data.location.length < 35) {
    data.formattedTitle = `Concert ${mainSubject} / ${data.location}`;
  } else {
    data.formattedTitle = `Concert ${mainSubject}`;
  }

  data.sample = sel.length > 0 ? sel : bodyText;
  return data;
}

const MONTH_MAP = {
  janvier: 1, janv: 1, jan: 1,
  fevrier: 2, "fevrier": 2, "février": 2, fevr: 2, feb: 2,
  mars: 3, mar: 3,
  avril: 4, avr: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6,
  juillet: 7, juil: 7, jul: 7,
  aout: 8, "aout": 8, "août": 8, aou: 8, aug: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, "decembre": 12, "décembre": 12, dec: 12
};

function extractDatesFromMetadata(pageData) {
  const currentYear = new Date().getFullYear();
  const events = [];
  let eventIdx = 0;

  // 1. Structured JSON-LD Dates (100% precise)
  if (pageData.structuredDates && pageData.structuredDates.length > 0) {
    pageData.structuredDates.forEach((sd) => {
      try {
        const start = new Date(sd.start);
        if (!isNaN(start.getTime())) {
          let end = sd.end ? new Date(sd.end) : null;
          if (!end || isNaN(end.getTime())) {
            end = new Date(start.getTime() + 2 * 3600 * 1000);
          }
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

  // 2. Text Regex Extraction (with robust time separator support: " | ", " à ", " - ")
  const text = pageData.sample || "";
  const rangePattern = /(?:du\s+)?(\d{1,2})\s+(?:au\s+(\d{1,2})\s+)?([a-zA-Z\u00C0-\u017F]+)(?:\s+(\d{4}))?(?:(?:\s*[\|\-,–—/àa@]\s*|\s+(?:à|a|at|vers|dès)\s*|\s+)(\d{1,2})[h:](\d{2})?)?/gi;
  const numericPattern = /\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{2,4}))?(?:(?:\s*[\|\-,–—/àa@]\s*|\s+(?:à|a|at|vers|dès)\s*|\s+)(\d{1,2})[h:](\d{2})?)?\b/g;

  let match;

  while ((match = rangePattern.exec(text)) !== null) {
    const startDay = parseInt(match[1], 10);
    const endDay = match[2] ? parseInt(match[2], 10) : null;
    const rawMonth = match[3].toLowerCase();
    const rawYear = match[4] ? parseInt(match[4], 10) : currentYear;
    let hour = match[5] ? parseInt(match[5], 10) : null;
    let minute = match[6] ? parseInt(match[6], 10) : 0;

    // Check adjacent text for time like " | 20:30" if not captured directly
    if (hour === null) {
      const lookahead = text.substring(match.index + match[0].length, match.index + match[0].length + 30);
      const timeMatch = lookahead.match(/^\s*(?:[\|\-,–—/:]|à|a|at|vers|dès)?\s*(\d{1,2})[h:](\d{2})\b/i);
      if (timeMatch) {
        hour = parseInt(timeMatch[1], 10);
        minute = parseInt(timeMatch[2], 10);
      } else {
        hour = 20;
      }
    }

    const monthNum = MONTH_MAP[rawMonth];
    if (monthNum && startDay >= 1 && startDay <= 31) {
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
    let year = match[3] ? parseInt(match[3], 10) : currentYear;
    if (year < 100) year += 2000;
    let hour = match[4] ? parseInt(match[4], 10) : null;
    let minute = match[5] ? parseInt(match[5], 10) : 0;

    // Check adjacent text for time like " | 20:30"
    if (hour === null) {
      const lookahead = text.substring(match.index + match[0].length, match.index + match[0].length + 30);
      const timeMatch = lookahead.match(/^\s*(?:[\|\-,–—/:]|à|a|at|vers|dès)?\s*(\d{1,2})[h:](\d{2})\b/i);
      if (timeMatch) {
        hour = parseInt(timeMatch[1], 10);
        minute = parseInt(timeMatch[2], 10);
      } else {
        hour = 20;
      }
    }

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

  if (detectedEvents.length === 0) {
    container.innerHTML = `<div class="text-muted small text-center py-3">No dates detected on this page. You can select date text on the page and click Scan again.</div>`;
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
    const formattedTime = evt.start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    item.innerHTML = `
      <div class="form-check d-flex align-items-center gap-2 mb-0">
        <input class="form-check-input evt-checkbox" type="checkbox" value="${evt.id}" id="chk-${evt.id}" checked>
        <label class="form-check-label small cursor-pointer" for="chk-${evt.id}">
          <span class="fw-semibold">${formattedDate}</span> <span class="text-muted">(${formattedTime})</span>
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
  const baseTitle = document.getElementById("event-input-title").value.trim() || "Concert / Spectacle";
  const location = document.getElementById("event-input-location").value.trim();
  const calendarTag = document.getElementById("event-input-calendar").value.trim();
  const sourceUrl = activeTabInfo ? activeTabInfo.url : "";

  const titleWithTag = calendarTag ? `[${calendarTag}] ${baseTitle}` : baseTitle;
  const details = `Extracted via SwissKnife Extension.\nSource: ${sourceUrl}`;

  eventList.forEach((evt) => {
    const startIso = formatGoogleCalendarDate(evt.start);
    const endIso = formatGoogleCalendarDate(evt.end);

    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      titleWithTag
    )}&dates=${startIso}/${endIso}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;

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
