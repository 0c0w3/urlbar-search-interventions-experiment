/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global QueryScorer */

// The possible study branches.
const BRANCHES = {
  CONTROL: "control",
  TREATMENT: "treatment",
};

// The possible tips to show.
const TIPS = {
  NONE: "",
  CLEAR: "clear",
  REFRESH: "refresh",

  // There's an update available, but the user's pref says we should ask them to
  // download and apply it.
  UPDATE_ASK: "update_ask",

  // The user's browser is up to date, but they triggered the update
  // intervention.  We show this special refresh intervention instead.
  UPDATE_REFRESH: "update_refresh",

  // There's an update and it's been downloaded and applied.  The user needs to
  // restart to finish.
  UPDATE_RESTART: "update_restart",

  // We can't update the browser or possibly even check for updates for some
  // reason, so the user should download the latest version from the web.
  UPDATE_WEB: "update_web",
};

// Keywords for each tip type.
const KEYWORDS = {
  update: [
    "2019",
    "browser",
    "download",
    "fire",
    "firefox",
    "fox",
    "free",
    "get",
    "install",
    "installer",
    "latest",
    "mac",
    "mozilla",
    "new",
    "newest",
    "quantum",
    "update",
    "updates",
    "version",
    "windows",
    "www.firefox.com",
  ],
  clear: [
    "cache",
    "clear",
    "cookie",
    "cookies",
    "delete",
    "firefox",
    "history",
    "load",
    "loading",
    "loads",
    "location",
    "page",
  ],
  refresh: [
    "crash",
    "crashes",
    "crashing",
    "firefox",
    "keep",
    "keeps",
    "not",
    "refresh",
    "reset",
    "respond",
    "responding",
    "responds",
    "slow",
    "slows",
    "work",
    "working",
    "works",
  ],
};

// Our browser.urlbar provider name.
const URLBAR_PROVIDER_NAME = "interventions";

// Telemetry names.
const TELEMETRY_ROOT = "urlbarInterventionsExperiment";
const TELEMETRY_SHOWN_PART = "tipShownCount";
const TELEMETRY_SHOWN = `${TELEMETRY_ROOT}.${TELEMETRY_SHOWN_PART}`;
const TELEMETRY_PICKED_PART = "tipPickedCount";
const TELEMETRY_PICKED = `${TELEMETRY_ROOT}.${TELEMETRY_PICKED_PART}`;

// The current study branch.
let studyBranch;

// The tip we should currently show.
let currentTip = TIPS.NONE;

// Object used to match the user's queries to tips.
let queryScorer = new QueryScorer();

// Tips shown in the current engagement (TIPS values).
let tipsShownInCurrentEngagement = new Set();

/**
 * browser.urlbar.onBehaviorRequested listener.
 */
async function onBehaviorRequested(query) {
  currentTip = TIPS.NONE;

  if (!query.searchString) {
    return "inactive";
  }

  // Get the scores and the top score.
  let docScores = queryScorer.score(query.searchString);
  let topDocScore = docScores[0];
  console.debug(docScores);

  // Multiple docs may have the top score, so collect them all.
  let topDocIDs = new Set();
  if (topDocScore.score != Infinity) {
    for (let { score, document } of docScores) {
      if (score != topDocScore.score) {
        break;
      }
      topDocIDs.add(document.id);
    }
  }

  // Determine the tip to show, if any.  If there are multiple top-score docs,
  // prefer them in the following order.
  if (topDocIDs.has("update")) {
    // There are several update tips.  Figure out which one to show.
    let status = await browser.experiments.urlbar.getBrowserUpdateStatus();
    switch (status) {
      case "downloading":
      case "staging":
      case "readyForRestart":
        // Prompt the user to restart.
        currentTip = TIPS.UPDATE_RESTART;
        break;
      case "downloadAndInstall":
        // There's an update available, but the user's pref says we should ask
        // them to download and apply it.
        currentTip = TIPS.UPDATE_ASK;
        break;
      case "noUpdatesFound":
        // We show a special refresh tip when the browser is up to date.
        currentTip = TIPS.UPDATE_REFRESH;
        break;
      case "checking":
        // The browser is checking for an update.  There's not much we can do in
        // this case without implementing a decent self-updating progress UI, so
        // just don't show anything.
        return "inactive";
      default:
        // Give up and ask the user to download the latest version from the web.
        currentTip = TIPS.UPDATE_WEB;
        break;
    }
  } else if (
    topDocIDs.has("clear") &&
    !(await browser.tabs.query({ active: true })).incognito
  ) {
    currentTip = TIPS.CLEAR;
  } else if (topDocIDs.has("refresh")) {
    currentTip = TIPS.REFRESH;
  } else {
    // No tip.
    return "inactive";
  }

  tipsShownInCurrentEngagement.add(currentTip);

  return studyBranch == BRANCHES.TREATMENT ? "active" : "inactive";
}

/**
 * browser.urlbar.onResultsRequested listener.
 */
async function onResultsRequested(query) {
  let result = {
    type: "tip",
    source: "local",
    suggestedIndex: 1,
    payload: {
      type: currentTip,
    },
  };

  switch (currentTip) {
    case TIPS.CLEAR:
      result.payload.text = "Clear Firefox’s cache, cookies, history and more.";
      result.payload.buttonText = "Choose What to Clear…";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/delete-browsing-search-download-history-firefox";
      break;
    case TIPS.REFRESH:
      result.payload.text =
        "Restore default settings and remove old add-ons for optimal performance.";
      result.payload.buttonText = "Refresh Firefox…";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/refresh-firefox-reset-add-ons-and-settings";
      break;
    case TIPS.UPDATE_ASK:
      result.payload.text = "A new version of Firefox is available.";
      result.payload.buttonText = "Install and Restart to Update";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/update-firefox-latest-release";
      break;
    case TIPS.UPDATE_REFRESH:
      result.payload.text =
        "Firefox is up to date. Trying to fix a problem? Restore default settings and remove old add-ons for optimal performance.";
      result.payload.buttonText = "Refresh Firefox…";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/refresh-firefox-reset-add-ons-and-settings";
      break;
    case TIPS.UPDATE_RESTART:
      result.payload.text =
        "The latest Firefox is downloaded and ready to install.";
      result.payload.buttonText = "Restart to Update";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/update-firefox-latest-release";
      break;
    case TIPS.UPDATE_WEB:
      result.payload.text = "Get the latest Firefox browser.";
      result.payload.buttonText = "Download Now";
      result.payload.helpUrl =
        "https://support.mozilla.org/kb/update-firefox-latest-release";
      break;
  }

  return [result];
}

/**
 * browser.urlbar.onResultPicked listener.  Called when a tip button is picked.
 */
async function onResultPicked(payload) {
  // Update picked-count telemetry.
  browser.telemetry.keyedScalarAdd(TELEMETRY_PICKED, payload.type, 1);

  switch (payload.type) {
    case TIPS.CLEAR:
      browser.experiments.urlbar.openClearHistoryDialog();
      break;
    case TIPS.REFRESH:
    case TIPS.UPDATE_REFRESH:
      browser.experiments.urlbar.resetBrowser();
      break;
    case TIPS.UPDATE_ASK:
      browser.experiments.urlbar.installBrowserUpdateAndRestart();
      break;
    case TIPS.UPDATE_RESTART:
      browser.experiments.urlbar.restartBrowser();
      break;
    case TIPS.UPDATE_WEB:
      browser.tabs.create({ url: "https://www.mozilla.org/firefox/new/" });
      break;
  }
}

/**
 * browser.urlbar.onEngagement listener.  Called when an engagement starts and
 * stops.
 */
async function onEngagement(state) {
  if (["engagement", "abandonment"].includes(state)) {
    for (let tip of tipsShownInCurrentEngagement) {
      browser.telemetry.keyedScalarAdd(TELEMETRY_SHOWN, tip, 1);
    }
  }
  tipsShownInCurrentEngagement.clear();
}

/**
 * Resets all the state we set on enrollment in the study.
 */
async function unenroll() {
  await browser.experiments.urlbar.engagementTelemetry.clear({});
  await browser.urlbar.onBehaviorRequested.removeListener(onBehaviorRequested);
  await browser.urlbar.onResultsRequested.removeListener(onResultsRequested);
  await browser.urlbar.onResultPicked.removeListener(onResultPicked);
  await browser.urlbar.onEngagement.removeListener(onEngagement);
  sendTestMessage("unenrolled");
}

/**
 * Sets up all appropriate state for enrollment in the study.
 */
async function enroll() {
  await browser.normandyAddonStudy.onUnenroll.addListener(async () => {
    await unenroll();
  });

  // Add urlbar listeners.
  await browser.urlbar.onBehaviorRequested.addListener(
    onBehaviorRequested,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onResultsRequested.addListener(
    onResultsRequested,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onResultPicked.addListener(
    onResultPicked,
    URLBAR_PROVIDER_NAME
  );
  await browser.urlbar.onEngagement.addListener(
    onEngagement,
    URLBAR_PROVIDER_NAME
  );

  // Enable urlbar engagement event telemetry.
  await browser.experiments.urlbar.engagementTelemetry.set({ value: true });

  // Register scalar telemetry.  We increment keyed scalars when we show a tip
  // and when the user picks a tip.
  await browser.telemetry.registerScalars(TELEMETRY_ROOT, {
    [TELEMETRY_SHOWN_PART]: {
      kind: "count",
      keyed: true,
      record_on_release: true,
    },
    [TELEMETRY_PICKED_PART]: {
      kind: "count",
      keyed: true,
      record_on_release: true,
    },
  });

  // Initialize the query scorer.
  for (let docID in KEYWORDS) {
    queryScorer.addDocument({ id: docID, words: KEYWORDS[docID] });
  }

  // Trigger a browser update check.  (This won't actually check if updates are
  // disabled for some reason, e.g., by policy.)
  await browser.experiments.urlbar.checkForBrowserUpdate();

  sendTestMessage("enrolled");
}

/**
 * Logs a debug message, which the test harness interprets as a message the
 * add-on is sending to the test.  See head.js for info.
 *
 * @param {string} msg
 *   The message.
 */
function sendTestMessage(msg) {
  console.debug(browser.runtime.id, msg);
}

(async function main() {
  // As a development convenience, act like we're enrolled in the treatment
  // branch if we're a temporary add-on.  onInstalled with details.temporary =
  // true will be fired in that case.  Add the listener now before awaiting the
  // study below to make sure we don't miss the event.
  let installPromise = new Promise(resolve => {
    browser.runtime.onInstalled.addListener(details => {
      resolve(details.temporary);
    });
  });

  // If we're enrolled in the study, set everything up, and then we're done.
  let study = await browser.normandyAddonStudy.getStudy();
  if (study) {
    // Sanity check the study.  This conditional should always be true.
    if (study.active && Object.values(BRANCHES).includes(study.branch)) {
      studyBranch = study.branch;
      await enroll();
    }
    sendTestMessage("ready");
    return;
  }

  // There's no study.  If installation happens, then continue with the
  // development convenience described above.
  installPromise.then(async isTemporaryInstall => {
    if (isTemporaryInstall) {
      console.debug("isTemporaryInstall");
      studyBranch = BRANCHES.TREATMENT;
      await enroll();
    }
    sendTestMessage("ready");
  });
})();
