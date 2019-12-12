/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * This file implements a framework for writing browser chrome tests against
 * Normandy experiment add-on files.
 */

"use strict";

XPCOMUtils.defineLazyModuleGetters(this, {
  AddonManager: "resource://gre/modules/AddonManager.jsm",
  AddonStudies: "resource://normandy/lib/AddonStudies.jsm",
  AddonTestUtils: "resource://testing-common/AddonTestUtils.jsm",
  ExtensionStorageIDB: "resource://gre/modules/ExtensionStorageIDB.jsm",
  NormandyTestUtils: "resource://testing-common/NormandyTestUtils.jsm",
  ResetProfile: "resource://gre/modules/ResetProfile.jsm",
  TelemetryTestUtils: "resource://testing-common/TelemetryTestUtils.jsm",
  UpdateUtils: "resource://gre/modules/UpdateUtils.jsm",
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.jsm",
});

const { WebExtensionPolicy } = Cu.getGlobalForObject(
  ChromeUtils.import("resource://gre/modules/Services.jsm", {})
);

// The path of the add-on file relative to `getTestFilePath`.
const ADDON_PATH = "urlbar_interventions-1.0a1.zip";

// Use SIGNEDSTATE_MISSING when testing an unsigned, in-development version of
// the add-on and SIGNEDSTATE_PRIVILEGED when testing the production add-on.
const EXPECTED_ADDON_SIGNED_STATE = AddonManager.SIGNEDSTATE_MISSING;
// const EXPECTED_ADDON_SIGNED_STATE = AddonManager.SIGNEDSTATE_PRIVILEGED;

const BRANCHES = {
  CONTROL: "control",
  TREATMENT: "treatment",
};

const TIPS = {
  NONE: "",
  CLEAR: "clear",
  REFRESH: "refresh",
  UPDATE_RESTART: "update_restart",
  UPDATE_ASK: "update_ask",
  UPDATE_REFRESH: "update_refresh",
  UPDATE_WEB: "update_web",
};

const TELEMETRY_ROOT = "urlbarInterventionsExperiment";
const TELEMETRY_SHOWN_PART = "tipShownCount";
const TELEMETRY_SHOWN = `${TELEMETRY_ROOT}.${TELEMETRY_SHOWN_PART}`;
const TELEMETRY_PICKED_PART = "tipPickedCount";
const TELEMETRY_PICKED = `${TELEMETRY_ROOT}.${TELEMETRY_PICKED_PART}`;

const SURVEY_URL = "https://qsurvey.mozilla.com/s3/Search-Interventions";

const FORCE_SURVEY_ENABLE = 1;
const FORCE_SURVEY_DISABLE = 2;

// For our app-update tests, we use helpers from the About window app-update
// tests.
//
// These globals are all in toolkit/mozapps/update/tests/browser/head.js, but we
// declare them individually instead of using `import-globals-from` because `npx
// eslint` from the repo directory wouldn't be able to find them.
/*
  global
  CONTINUE_CHECK,
  CONTINUE_DOWNLOAD,
  CONTINUE_STAGING,
  continueFileHandler,
  gAUS,
  gDetailsURL,
  gEnv,
  gUpdateManager,
  getPatchOfType,
  getVersionParams,
  logTestInfo,
  PREF_APP_UPDATE_BITS_ENABLED,
  PREF_APP_UPDATE_DISABLEDFORTESTING,
  PREF_APP_UPDATE_STAGING_ENABLED,
  PREF_APP_UPDATE_URL_MANUAL,
  setUpdateURL,
  setupTestUpdater,
  STATE_APPLIED,
  STATE_DOWNLOADING,
  STATE_PENDING,
  URL_HTTP_UPDATE_SJS
*/
Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/toolkit/mozapps/update/tests/browser/head.js",
  this
);

AddonTestUtils.initMochitest(this);

/**
 * {nsIFile} The add-on file under test.
 */
let gAddonFile;

/**
 * {object} The manifest of the add-on under test.
 */
let gAddonManifest;

/**
 * {integer} The expected signed state of the add-on under test, one of the
 * AddonManager.SIGNEDSTATE_* values.
 */
let gExpectedAddonSignedState;

/**
 * {string} The ID of the add-on under test.
 */
Object.defineProperty(this, "gAddonID", {
  get: () =>
    gAddonManifest.browser_specific_settings.gecko.id ||
    gAddonManifest.applications.gecko.id,
});

/**
 * {string} The version of the add-on under test.
 */
Object.defineProperty(this, "gAddonVersion", {
  get: () => gAddonManifest.version,
});

/**
 * You must call this to initialize your test.
 *
 * @param {string} addonFilePath
 *   The path to the add-on file under test, relative to `getTestFilePath`.  If
 *   the file is in the same directory as the test, this is just the basename.
 * @param {integer} expectedSignedState
 *   The signed state of the add-on file, one of the AddonManager.SIGNEDSTATE_*
 *   values.  While your add-on is in development and unsigned, pass
 *   AddonManager.SIGNEDSTATE_MISSING.  When your add-on is signed for release,
 *   pass AddonManager.SIGNEDSTATE_PRIVILEGED.
 */
async function initAddonTest(addonFilePath, expectedSignedState) {
  gAddonFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  gAddonFile.initWithPath(getTestFilePath(addonFilePath));

  // Load the add-on's manifest.  We'll get all the metadata from it so that
  // tests don't need to repeat it.
  let manifestURI = AddonTestUtils.getManifestURI(gAddonFile);
  let body = await fetch(manifestURI.spec);
  gAddonManifest = await body.json();
  info("Got add-on manifest: " + JSON.stringify(gAddonManifest, undefined, 2));

  gExpectedAddonSignedState = expectedSignedState;

  // Load our process script that listens for messages from the add-on.  There
  // doesn't seem to be a simple way for chrome to receive messages from actual
  // non-toy add-ons.  So we add a console-api-log-event observer in the child
  // process, listen for special log messages from the add-on, and forward them
  // to chrome.  The add-on should log a message with two arguments: its add-on
  // ID and the message type.
  let processScriptArgs = [gAddonID];
  function __processScript__(addonID) {
    let { Services } = ChromeUtils.import(
      "resource://gre/modules/Services.jsm"
    );
    Services.obs.addObserver((subject, topic, data) => {
      let msg = subject.wrappedJSObject;
      if (msg.addonId == addonID && msg.arguments.length == 2) {
        let [msgName, msgType] = msg.arguments;
        if (msgName == addonID) {
          Services.cpmm.sendAsyncMessage(msgName, msgType);
        }
      }
    }, "console-api-log-event");
  }
  Services.ppmm.loadProcessScript(
    "data:,(" +
      __processScript__.toString() +
      ")(..." +
      JSON.stringify(processScriptArgs) +
      ")",
    true
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      // Show the extension's console messages in stdout and the browser
      // console.  This isn't required, but it's useful for debugging.
      ["devtools.console.stdout.content", true],
      ["devtools.browserconsole.contentMessages", true],
    ],
  });
}

/**
 * Waits for a message from the add-on.
 *
 * To send a message to the test, the add-on should call console.debug() or
 * another console logging function and pass two arguments: its add-on ID (which
 * it can get with `browser.runtime.id`) and the message.
 *
 * Your add-on and test can use whatever messages they need in order to properly
 * test the add-on.  For example, useful messages might be "enrolled" and
 * "unenrolled", which your add-on would send when it finishes enrolling and
 * unenrolling in your study.
 *
 * In addition, this file defines the following messages:
 *
 *   * ready: Should be sent by the add-on when its initialization is complete
 *     and it's ready to be tested.  See `withAddon`.
 *
 * @param {string} msg
 *   The expected message.
 */
async function awaitAddonMessage(msg) {
  await new Promise(resolve => {
    let listener = receivedMsg => {
      if (receivedMsg.data == msg) {
        Services.ppmm.removeMessageListener(gAddonID, listener);
        resolve();
      }
    };
    Services.ppmm.addMessageListener(gAddonID, listener);
  });
}

/**
 * Sets up a mock experiment study, calls your callback, and then removes the
 * study.
 *
 * @param {object} studyPartial
 *   A plain JS object that includes any of the recognized study properties.
 *   All properties are optional and will default to mock values.  For info on
 *   these properties, see AddonStudies.jsm and NormandyTestUtils.jsm.
 * @param {function} callback
 *   Your callback.  It will be passed the full study object, which is a plain
 *   JS object.
 */
async function withStudy(studyPartial, callback) {
  let study = NormandyTestUtils.factories.addonStudyFactory(
    Object.assign(
      {
        addonId: gAddonID,
        addonVersion: gAddonVersion,
      },
      studyPartial
    )
  );
  await AddonStudies.withStudies([study])(async studies => {
    await callback(studies[0]);
  })();
}

/**
 * Installs the add-on under test (which you should have specified by calling
 * `initAddonTest`), calls your callback, and then uninstalls the add-on.
 *
 * IMPORTANT: The add-on must send a "ready" message when it has finished
 * initialization and is ready to be tested.  This allows add-ons to perform any
 * async initialization they require before the test starts.  See
 * `awaitAddonMessage` for info on sending messages from the add-on.
 *
 * @param {function} callback
 *   Your callback.  It will be passed the add-on object, which is an instance
 *   of AddonWrapper (defined in XPIDatabase.jsm).
 */
async function withAddon(callback) {
  let addon = await installAddon();
  await callback(addon);
  await uninstallAddon(addon);
}

async function installAddon() {
  // If the add-on isn't signed, then as a convenience during development,
  // install it as a temporary add-on so that it can use privileged APIs.  If it
  // is signed, install it normally.
  let [, addon] = await Promise.all([
    awaitAddonMessage("ready"),
    gExpectedAddonSignedState === AddonManager.SIGNEDSTATE_MISSING
      ? AddonManager.installTemporaryAddon(gAddonFile)
      : AddonTestUtils.promiseInstallFile(gAddonFile).then(
          install => install.addon
        ),
  ]);

  Assert.strictEqual(
    addon.signedState,
    gExpectedAddonSignedState,
    "The add-on should have the expected signed state"
  );

  return addon;
}

async function uninstallAddon(addon) {
  // If `withStudy` was called and there's an active study, Normandy will
  // automatically end the study when it sees that the add-on has been
  // uninstalled.  That's fine, but that automatic unenrollment will race the
  // unenrollment performed by `withStudy` and can cause database access errors
  // within Normandy.  To avoid that, wait here for the current study to end.
  let studyActive = (await AddonStudies.getAllActive()).some(
    study => study.addonId == gAddonID
  );

  await Promise.all([
    studyActive
      ? TestUtils.topicObserved("shield-study-ended")
      : Promise.resolve(),
    addon.uninstall(),
  ]);
}

/**
 * Checks a tip on the treatment branch: Starts a search that should trigger a
 * tip, picks the tip, waits for the tip's action to happen, and checks scalar
 * telemetry (the telemetry recorded by the extension).
 *
 * @param {string} searchString
 *   The search string.
 * @param {TIPS.*} tip
 *   The expected tip type.
 * @param {string} title
 *   The expected tip title.
 * @param {string} button
 *   The expected button title.
 * @param {function} awaitCallback
 *   A function that checks the tip's action.  Should return a promise (or be
 *   async).
 * @return {*}
 *   The value returned from `awaitCallback`.
 */
async function doTreatmentTest({
  searchString,
  tip,
  title,
  button,
  awaitCallback,
} = {}) {
  Services.telemetry.clearScalars();
  await forceSurvey(FORCE_SURVEY_DISABLE);

  // Do a search that triggers the tip.
  let [result, element] = await awaitTip(searchString);
  Assert.strictEqual(result.payload.type, tip);
  Assert.equal(element._elements.get("title").textContent, title);
  Assert.equal(element._elements.get("tipButton").textContent, button);
  Assert.ok(BrowserTestUtils.is_visible(element._elements.get("helpButton")));

  // Pick the tip, which should open the refresh dialog.  Click its cancel
  // button.
  let values = await Promise.all([awaitCallback(), pickTip()]);
  Assert.ok(true, "Refresh dialog opened");

  // Shown- and picked-count telemetry should be updated.
  let scalars = TelemetryTestUtils.getProcessScalars("dynamic", true, true);
  for (let name of [TELEMETRY_SHOWN, TELEMETRY_PICKED]) {
    TelemetryTestUtils.assertKeyedScalar(scalars, name, tip, 1);
  }

  return values[0] || null;
}

/**
 * Checks for the absence of a tip on the control branch: Starts a search that
 * should trigger a tip on the treatment branch, makes sure no tip appears, and
 * checks scalar telemetry (the telemetry recorded by the extension).
 *
 * @param {string} searchString
 *   The search string.
 * @param {TIPS.*} tip
 *   The expected tip type (which should not appear).
 */
async function doControlTest({ searchString, tip } = {}) {
  Services.telemetry.clearScalars();
  await forceSurvey(FORCE_SURVEY_DISABLE);

  // Do a search that would trigger the tip.
  await awaitNoTip(searchString);

  // Blur the urlbar so that the engagement is ended and telemetry is recorded.
  await UrlbarTestUtils.promisePopupClose(window, () => gURLBar.blur());

  // Shown-count telemetry should be updated, but not picked count.
  await TestUtils.waitForCondition(
    () =>
      TELEMETRY_SHOWN in TelemetryTestUtils.getProcessScalars("dynamic", true),
    "Wait for telemetry to be recorded"
  );
  let scalars = TelemetryTestUtils.getProcessScalars("dynamic", true, true);
  TelemetryTestUtils.assertKeyedScalar(scalars, TELEMETRY_SHOWN, tip, 1);
  Assert.ok(!(TELEMETRY_PICKED in scalars));
}

/**
 * Initializes a mock app update.  This function and the other update-related
 * functions are adapted from `runAboutDialogUpdateTest` here:
 * https://searchfox.org/mozilla-central/source/toolkit/mozapps/update/tests/browser/head.js
 */
async function initUpdate(params) {
  gEnv.set("MOZ_TEST_SLOW_SKIP_UPDATE_STAGE", "1");
  await SpecialPowers.pushPrefEnv({
    set: [
      [PREF_APP_UPDATE_DISABLEDFORTESTING, false],
      [PREF_APP_UPDATE_URL_MANUAL, gDetailsURL],
    ],
  });

  await setupTestUpdater();

  let queryString = params.queryString ? params.queryString : "";
  let updateURL =
    URL_HTTP_UPDATE_SJS +
    "?detailsURL=" +
    gDetailsURL +
    queryString +
    getVersionParams();
  if (params.backgroundUpdate) {
    setUpdateURL(updateURL);
    gAUS.checkForBackgroundUpdates();
    if (params.continueFile) {
      await continueFileHandler(params.continueFile);
    }
    if (params.waitForUpdateState) {
      await TestUtils.waitForCondition(
        () =>
          gUpdateManager.activeUpdate &&
          gUpdateManager.activeUpdate.state == params.waitForUpdateState,
        "Waiting for update state: " + params.waitForUpdateState,
        undefined,
        200
      ).catch(e => {
        // Instead of throwing let the check below fail the test so the panel
        // ID and the expected panel ID is printed in the log.
        logTestInfo(e);
      });
      // Display the UI after the update state equals the expected value.
      Assert.equal(
        gUpdateManager.activeUpdate.state,
        params.waitForUpdateState,
        "The update state value should equal " + params.waitForUpdateState
      );
    }
  } else {
    updateURL += "&slowUpdateCheck=1&useSlowDownloadMar=1";
    setUpdateURL(updateURL);
  }
}

/**
 * Performs steps in a mock update.  This function and the other update-related
 * functions are adapted from `runAboutDialogUpdateTest` here:
 * https://searchfox.org/mozilla-central/source/toolkit/mozapps/update/tests/browser/head.js
 */
async function processUpdateSteps(steps) {
  for (let step of steps) {
    await processUpdateStep(step);
  }
}

/**
 * Performs a step in a mock update.  This function and the other update-related
 * functions are adapted from `runAboutDialogUpdateTest` here:
 * https://searchfox.org/mozilla-central/source/toolkit/mozapps/update/tests/browser/head.js
 */
async function processUpdateStep(step) {
  if (typeof step == "function") {
    step();
    return;
  }

  const { panelId, checkActiveUpdate, continueFile, downloadInfo } = step;
  if (checkActiveUpdate) {
    await TestUtils.waitForCondition(
      () => gUpdateManager.activeUpdate,
      "Waiting for active update"
    );
    Assert.ok(
      !!gUpdateManager.activeUpdate,
      "There should be an active update"
    );
    Assert.equal(
      gUpdateManager.activeUpdate.state,
      checkActiveUpdate.state,
      "The active update state should equal " + checkActiveUpdate.state
    );
  } else {
    Assert.ok(
      !gUpdateManager.activeUpdate,
      "There should not be an active update"
    );
  }

  if (panelId == "downloading") {
    for (let i = 0; i < downloadInfo.length; ++i) {
      let data = downloadInfo[i];
      // The About Dialog tests always specify a continue file.
      await continueFileHandler(continueFile);
      let patch = getPatchOfType(data.patchType);
      // The update is removed early when the last download fails so check
      // that there is a patch before proceeding.
      let isLastPatch = i == downloadInfo.length - 1;
      if (!isLastPatch || patch) {
        let resultName = data.bitsResult ? "bitsResult" : "internalResult";
        patch.QueryInterface(Ci.nsIWritablePropertyBag);
        await TestUtils.waitForCondition(
          () => patch.getProperty(resultName) == data[resultName],
          "Waiting for expected patch property " +
            resultName +
            " value: " +
            data[resultName],
          undefined,
          200
        ).catch(e => {
          // Instead of throwing let the check below fail the test so the
          // property value and the expected property value is printed in
          // the log.
          logTestInfo(e);
        });
        Assert.equal(
          patch.getProperty(resultName),
          data[resultName],
          "The patch property " +
            resultName +
            " value should equal " +
            data[resultName]
        );
      }
    }
  } else if (continueFile) {
    await continueFileHandler(continueFile);
  }
}

/**
 * Starts a search and asserts that the second result is a tip.
 *
 * @param {string} searchString
 *   The search string.
 * @return {[result, element]}
 *   The result and its element in the DOM.
 */
async function awaitTip(searchString, win = window) {
  let context = await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window: win,
    value: searchString,
    waitForFocus,
    fireInputEvent: true,
  });
  Assert.ok(context.results.length >= 2);
  let result = context.results[1];
  Assert.equal(result.type, UrlbarUtils.RESULT_TYPE.TIP);
  let element = await UrlbarTestUtils.waitForAutocompleteResultAt(win, 1);
  return [result, element];
}

/**
 * Starts a search and asserts that there are no tips.
 *
 * @param {string} searchString
 *   The search string.
 */
async function awaitNoTip(searchString, win = window) {
  let context = await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window: win,
    value: searchString,
    waitForFocus,
    fireInputEvent: true,
  });
  for (let result of context.results) {
    Assert.notEqual(result.type, UrlbarUtils.RESULT_TYPE.TIP);
  }
}

/**
 * Picks the current tip's button.  The view should be open and the second
 * result should be a tip.
 */
async function pickTip() {
  let result = await UrlbarTestUtils.getDetailsOfResultAt(window, 1);
  let button = result.element.row._elements.get("tipButton");
  await UrlbarTestUtils.promisePopupClose(window, () => {
    EventUtils.synthesizeMouseAtCenter(button, {});
  });
}

/**
 * Waits for the quit-application-requested notification and cancels it (so that
 * the app isn't actually restarted).
 */
async function awaitAppRestartRequest() {
  await TestUtils.topicObserved(
    "quit-application-requested",
    (cancelQuit, data) => {
      if (data == "restart") {
        cancelQuit.QueryInterface(Ci.nsISupportsPRBool).data = true;
        return true;
      }
      return false;
    }
  );
}

/**
 * Sets up the profile so that it can be reset.
 */
function makeProfileResettable() {
  // Make reset possible.
  let profileService = Cc["@mozilla.org/toolkit/profile-service;1"].getService(
    Ci.nsIToolkitProfileService
  );
  let currentProfileDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
  let profileName = "mochitest-test-profile-temp-" + Date.now();
  let tempProfile = profileService.createProfile(
    currentProfileDir,
    profileName
  );
  Assert.ok(
    ResetProfile.resetSupported(),
    "Should be able to reset from mochitest's temporary profile once it's in the profile manager."
  );

  registerCleanupFunction(() => {
    tempProfile.remove(false);
    Assert.ok(
      !ResetProfile.resetSupported(),
      "Shouldn't be able to reset from mochitest's temporary profile once removed from the profile manager."
    );
  });
}

/**
 * Gets a connection to the extension's "local" storage, which is an IndexedDB
 * database.
 *
 * @return {object}
 *   The IndexedDB connection.
 */
async function getExtensionStorage() {
  let policy = WebExtensionPolicy.getByID(gAddonID);
  let storagePrincipal = ExtensionStorageIDB.getStoragePrincipal(
    policy.extension
  );
  return ExtensionStorageIDB.open(storagePrincipal);
}

/**
 * Sets the `forceSurvey` value in the extension's local storage.
 *
 * @return {number} value
 *   The value to set:
 *   * 0 (or undefined): Don't force either way
 *   * 1: Force the survey to open
 *   * 2: Force the survey not to open
 */
async function forceSurvey(value) {
  let conn = await getExtensionStorage();
  await conn.set({ surveyURL: "http://example.com/", forceSurvey: value });
}
