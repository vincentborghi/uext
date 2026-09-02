// Content script to safely extract page content and selection

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageData") {
    const selection = window.getSelection().toString().trim();
    const pageTitle = document.title || "";
    const pageUrl = window.location.href || "";
    
    // Grab text content from main article or body
    const mainEl = document.querySelector("main") || document.querySelector("article") || document.body;
    const pageText = (mainEl ? mainEl.innerText : document.body.innerText || "").substring(0, 15000);
    
    sendResponse({
      title: pageTitle,
      url: pageUrl,
      selection: selection,
      textSample: pageText
    });
  }
  return true;
});
