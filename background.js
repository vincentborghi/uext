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
      const DEFAULT_PROXY = "https://bnf.idm.oclc.org/login?url=";
      chrome.storage.local.get({ bnfProxyTemplate: DEFAULT_PROXY }, (res) => {
        let prefix = res.bnfProxyTemplate || DEFAULT_PROXY;
        if (prefix.includes("acces-distant.bnf.fr")) {
          prefix = DEFAULT_PROXY;
          chrome.storage.local.set({ bnfProxyTemplate: DEFAULT_PROXY });
        }
        const finalUrl = prefix.includes("%s") 
          ? prefix.replace("%s", encodeURIComponent(targetUrl))
          : prefix + encodeURIComponent(targetUrl);
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
