// Use of this source code is governed by a license that can be
// found in the LICENSE file.

'use strict';

// Ask background.js about the state of this tab, and update popup accordingly.
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  chrome.runtime.sendMessage({ type: "getTabInfo", tab: tabs[0] }, (response) => updatePopup(response));
});

// Add a listener to receive dynamic updates from background.js
chrome.runtime.onMessage.addListener((request, s, c) => {

  if (request.type == "updateFromBackground") {
    updatePopup(request.data);
  }
});

// Hook up buttons
document.getElementById('downloadUrl').onclick = () =>
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.runtime.sendMessage({ type: "downloadUrl", tab: tabs[0] });
  });

document.getElementById('downloadLocal1280').onclick = () =>
  chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
    try {
      await downloadEhGalleryLocally(tabs[0]);
    } catch (error) {
      notifyLocalDownload(`Local download failed: ${error}`);
    }
  });

document.getElementById('downloadLeft').onclick = () =>
  chrome.tabs.query({ currentWindow: true }, function (tabs) {
    chrome.runtime.sendMessage({ type: "batchDownload", tabs: getLeftSideTags(tabs) });
  });

document.getElementById('downloadRight').onclick = () =>
  chrome.tabs.query({ currentWindow: true }, function (tabs) {
    chrome.runtime.sendMessage({ type: "batchDownload", tabs: getRightSideTags(tabs) });
  });


document.getElementById('allDownloads').onclick = () => chrome.storage.sync.get(['server'], function (result) {
  if (typeof result.server !== 'undefined' && result.server.trim() !== "") // check for undefined
    chrome.tabs.create({
      url: `${result.server}/minion/jobs`
    });
});


document.getElementById('openSettings').onclick = () => chrome.runtime.openOptionsPage();

document.getElementById('recheckTab').onclick = () =>
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.runtime.sendMessage({ type: "recheckTab", tab: tabs[0] });
  });

// Wow actual logic
function updatePopup(dataFromBackground) {

  console.log("Received data from background.js: " + JSON.stringify(dataFromBackground));
  document.getElementById('statusMsg').style = "color:black"
  document.getElementById('downloadUrl').disabled = false;

  try {
    switch (dataFromBackground.status) {
      case "downloaded":
        document.getElementById('statusIcon').textContent = "✅";
        document.getElementById('statusMsg').textContent = " saved to your LRR server!";
        document.getElementById('statusMsg').style = "color:green"
        document.getElementById('downloadUrl').disabled = true;

        chrome.storage.sync.get(['server'], function (result) {
          safeHtmlInject(document.getElementById('statusDetail'),
            `<span>(id: <a href="${result.server}/reader?id=${dataFromBackground.arcId}" target= "_blank">
                  ${dataFromBackground.arcId}
                </a>)</span>`);
        });


        break;
      case "downloading":
        document.getElementById('statusIcon').textContent = "🔜";
        document.getElementById('statusMsg').textContent = " being downloaded...";
        document.getElementById('statusMsg').style = "color:blue"
        document.getElementById('statusDetail').textContent = `(job: #${dataFromBackground.jobId})`;
        break;
      case "checking":
        document.getElementById('statusIcon').textContent = "⌛";
        document.getElementById('statusMsg').textContent = " being checked...";
        document.getElementById('statusMsg').style = "color:orange"
        document.getElementById('statusDetail').textContent = `(Please wait warmly.)`;
        break;
      case "other":
        document.getElementById('statusIcon').textContent = "⁉";
        document.getElementById('statusMsg').textContent = "... just a tab.";
        document.getElementById('statusDetail').textContent = `(${dataFromBackground.message})`;
        break;
      case "error":
        document.getElementById('statusIcon').textContent = "❌";
        document.getElementById('statusMsg').textContent = " not okay.";
        document.getElementById('statusMsg').style = "color:red"
        document.getElementById('statusDetail').textContent = `(Error: ${dataFromBackground.message})`;
        break;
      default:
        document.getElementById('statusIcon').textContent = "👻";
        document.getElementById('statusMsg').textContent = " a mystery.";
        document.getElementById('statusDetail').textContent = `(Unknown status message ${dataFromBackground.status})`;
    }
  } catch (e) {
    console.log(e);
    document.getElementById('statusIcon').textContent = "👻";
    document.getElementById('statusMsg').textContent = " a mystery.";
    document.getElementById('statusDetail').textContent = `(${e})`;
  }
}

function getLeftSideTags(tabs) {
  var filtered_tabs = [];
  var activeIndex = -1;

  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].active) {
      activeIndex = tabs[i].index;
      break;
    }
  }

  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].index < activeIndex) {
      filtered_tabs.push(tabs[i]);
    }
  }

  return filtered_tabs;
}

function getRightSideTags(tabs) {
  var filtered_tabs = [];
  var activeIndex = -1;

  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].active) {
      activeIndex = tabs[i].index;
      break;
    }
  }

  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].index > activeIndex) {
      filtered_tabs.push(tabs[i]);
    }
  }

  return filtered_tabs;
}

// Thanks firefox I guess https://devtidbits.com/2017/12/06/quick-fix-the-unsafe_var_assignment-warning-in-javascript
function safeHtmlInject(element, html) {

  element.textContent = "";

  const parser = new DOMParser()
  const parsed = parser.parseFromString(html, "text/html")
  const tags = parsed.getElementsByTagName("body")[0].children;

  for (const tag of tags) {
    element.appendChild(tag)
  }

}

async function downloadEhGalleryLocally(tab) {

  if (!tab?.url || !isEhGalleryUrl(tab.url))
    throw new Error("This button only works on E-Hentai/ExHentai gallery pages.");

  const ids = extractGalleryIdentifiers(tab.url);
  if (!ids)
    throw new Error("Couldn't parse gallery gid/token from this URL.");

  const archiverUrl = `${ids.origin}/archiver.php?gid=${ids.gid}&token=${ids.token}`;
  notifyLocalDownload("Requesting EH resized archive...");

  const html = await requestResampledArchive(archiverUrl);
  const archiveUrl = extractArchiveDownloadUrl(html, ids.origin);

  if (archiveUrl) {
    await queueBrowserDownload(archiveUrl);
    notifyLocalDownload("Queued resized archive download.");
    return;
  }

  await openTab(archiverUrl);
  notifyLocalDownload("Archive requested. Opened archiver page to finish download.");
}

function isEhGalleryUrl(url) {
  return /^https:\/\/(e-hentai\.org|exhentai\.org)\/g\/[^/]+\/[^/]+\/?/.test(url);
}

function extractGalleryIdentifiers(url) {
  const match = url.match(/^(https:\/\/(?:e-hentai\.org|exhentai\.org))\/g\/([^/]+)\/([^/]+)\/?/);
  if (!match) return null;
  return { origin: match[1], gid: match[2], token: match[3] };
}

async function requestResampledArchive(archiverUrl) {
  const body = new URLSearchParams();
  body.set("dltype", "res");
  body.set("dlcheck", "Download Resample Archive");

  const response = await fetch(archiverUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok)
    throw new Error(`Archive request failed (${response.status}).`);

  return await response.text();
}

function extractArchiveDownloadUrl(html, origin) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const links = [...parsed.querySelectorAll("a[href]")];

  const directLink = links
    .map(l => l.getAttribute("href"))
    .find(href => href && /archive|download|hath|file/.test(href));

  if (!directLink) return null;

  if (directLink.startsWith("http://") || directLink.startsWith("https://"))
    return directLink;
  if (directLink.startsWith("/"))
    return `${origin}${directLink}`;
  return `${origin}/${directLink}`;
}

async function queueBrowserDownload(url) {
  await new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      saveAs: false,
      conflictAction: "uniquify"
    }, () => {
      if (chrome.runtime.lastError)
        reject(chrome.runtime.lastError.message);
      else
        resolve();
    });
  });
}

async function openTab(url) {
  await new Promise((resolve, reject) => {
    chrome.tabs.create({ url: url }, () => {
      if (chrome.runtime.lastError)
        reject(chrome.runtime.lastError.message);
      else
        resolve();
    });
  });
}

function notifyLocalDownload(message) {
  chrome.notifications?.create(null, {
    type: "basic",
    title: "Tsukihi local download",
    message: message,
    iconUrl: "images/get_started128.png"
  }, null);
}
