/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Checks the UPDATE_ASK tip on the treatment branch.
//
// The update parts of this test are adapted from:
// https://searchfox.org/mozilla-central/source/toolkit/mozapps/update/tests/browser/browser_aboutDialog_fc_downloadOptIn.js

"use strict";

let params = { queryString: "&invalidCompleteSize=1" };

let downloadInfo = [];
if (Services.prefs.getBoolPref(PREF_APP_UPDATE_BITS_ENABLED, false)) {
  downloadInfo[0] = { patchType: "partial", bitsResult: "0" };
} else {
  downloadInfo[0] = { patchType: "partial", internalResult: "0" };
}

let preSteps = [
  {
    panelId: "checkingForUpdates",
    checkActiveUpdate: null,
    continueFile: CONTINUE_CHECK,
  },
  {
    panelId: "downloadAndInstall",
    checkActiveUpdate: null,
    continueFile: null,
  },
];

let postSteps = [
  {
    panelId: "downloading",
    checkActiveUpdate: { state: STATE_DOWNLOADING },
    continueFile: CONTINUE_DOWNLOAD,
    downloadInfo,
  },
  {
    panelId: "apply",
    checkActiveUpdate: { state: STATE_PENDING },
    continueFile: null,
  },
];

add_task(async function test() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);

  // Disable the pref that automatically downloads and installs updates.
  await UpdateUtils.setAppUpdateAutoEnabled(false);

  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await initUpdate(params);
    await withAddon(async () => {
      // Set up the "download and install" update state.
      await processUpdateSteps(preSteps);

      // Pick the tip and continue with the mock update, which should attempt to
      // restart the browser.
      await doTreatmentTest({
        searchString: SEARCH_STRINGS.UPDATE,
        tip: TIPS.UPDATE_ASK,
        title: "A new version of Firefox is available.",
        button: "Install and Restart to Update",
        awaitCallback() {
          return Promise.all([
            processUpdateSteps(postSteps),
            awaitAppRestartRequest(),
          ]);
        },
      });
    });
  });
});
