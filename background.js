// Background service worker for My Extras Extension

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu items
  chrome.contextMenus.create({
    id: "myextras-bnf-open",
    title: "Open page via BnF Remote Access",
    contexts: ["page", "link"]
  });

  chrome.contextMenus.create({
    id: "myextras-save-track",
    title: "Save selection as Music Track",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "myextras-extract-calendar",
    title: "Extract dates to Calendar from selection",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "myextras-open-window",
    title: "Open in standalone window",
    contexts: ["action"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "myextras-open-window") {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup/popup.html?mode=window"),
      type: "popup",
      width: 960,
      height: 850
    });
  } else if (info.menuItemId === "myextras-bnf-open") {
    const targetUrl = info.linkUrl || info.pageUrl || tab?.url;
    if (targetUrl) {
      chrome.storage.local.get({ bnfProxyTemplate: "" }, (res) => {
        const customTemplate = res.bnfProxyTemplate || "";
        const finalUrl = rewriteUrlToBnfProxy(targetUrl, customTemplate);
        chrome.tabs.create({ url: finalUrl });
      });
    }
  } else if (info.menuItemId === "myextras-save-track") {
    const selectedText = (info.selectionText || "").trim();
    if (selectedText) {
      const parts = selectedText.split(/\s*[-–—:]\s*/);
      let artist = "";
      let title = selectedText;
      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(" - ").trim();
      }
      const newTrack = {
        id: "trk_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        title: title,
        artist: artist,
        album: "",
        year: "",
        origin: "Web Selection",
        tags: ["web"],
        rating: 0,
        notes: "Captured from: " + (tab ? tab.title : ""),
        links: {},
        coverUrl: "",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      chrome.storage.local.get({ musicLibrary: [] }, (res) => {
        const list = res.musicLibrary || [];
        list.unshift(newTrack);
        chrome.storage.local.set({ musicLibrary: list });
      });
    }
  } else if (info.menuItemId === "myextras-extract-calendar") {
    const selectedText = (info.selectionText || "").trim();
    if (selectedText) {
      chrome.storage.local.set({
        pendingCalendarSelection: selectedText,
        lastActiveTab: "#tab-events"
      }, () => {
        if (chrome.action && chrome.action.openPopup) {
          chrome.action.openPopup().catch(() => {
            // Popup opening may be ignored if suppressed by browser
          });
        }
      });
    }
  }
});

function rewriteUrlToBnfProxy(rawUrl, customTemplate = "") {
  if (!rawUrl) return "";

  // If user configured a custom template with %s
  if (customTemplate && customTemplate.includes("%s")) {
    return customTemplate.replace("%s", encodeURIComponent(rawUrl));
  }
  // If user explicitly configured a prefix ending in '='
  if (customTemplate && customTemplate.endsWith("=")) {
    return customTemplate + encodeURIComponent(rawUrl);
  }

  // If already proxied by BnF EZProxy, keep it
  if (rawUrl.includes(".bnf.idm.oclc.org") || rawUrl.includes("bnf.fr")) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    // OCLC EZproxy subdomain rewrite: replace all dots in hostname with hyphens
    // e.g. www.mediapart.fr -> www-mediapart-fr.bnf.idm.oclc.org
    const hostWithDashes = parsed.hostname.replace(/\./g, "-");
    const proxiedHost = `${hostWithDashes}.bnf.idm.oclc.org`;
    const portPart = (parsed.port && parsed.port !== "80" && parsed.port !== "443") ? `:${parsed.port}` : "";
    return `https://${proxiedHost}${portPart}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (e) {
    return `https://login.bnf.idm.oclc.org/login?qurl=${encodeURIComponent(rawUrl)}`;
  }
}
