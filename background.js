// Background service worker for SwissKnife Extension

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu items
  chrome.contextMenus.create({
    id: "swissknife-bnf-open",
    title: "Open page via BnF Remote Access",
    contexts: ["page", "link"]
  });

  chrome.contextMenus.create({
    id: "swissknife-save-track",
    title: "Save selection as Music Track",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "swissknife-extract-calendar",
    title: "Extract dates to Calendar from selection",
    contexts: ["selection"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "swissknife-bnf-open") {
    const targetUrl = info.linkUrl || info.pageUrl || tab?.url;
    if (targetUrl) {
      chrome.storage.local.get({ bnfProxyTemplate: "https://acces-distant.bnf.fr/login?url=" }, (res) => {
        const prefix = res.bnfProxyTemplate || "https://acces-distant.bnf.fr/login?url=";
        const finalUrl = prefix.includes("%s") 
          ? prefix.replace("%s", encodeURIComponent(targetUrl))
          : prefix + encodeURIComponent(targetUrl);
        chrome.tabs.create({ url: finalUrl });
      });
    }
  } else if (info.menuItemId === "swissknife-save-track") {
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
        createdAt: Date.now()
      };
      chrome.storage.local.get({ musicLibrary: [] }, (res) => {
        const list = res.musicLibrary || [];
        list.unshift(newTrack);
        chrome.storage.local.set({ musicLibrary: list });
      });
    }
  }
});
