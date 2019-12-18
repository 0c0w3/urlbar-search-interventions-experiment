/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Checks the UPDATE_ASK tip on the control branch.
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

add_task(async function test() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);

  // Disable the pref that automatically downloads and installs updates.
  await UpdateUtils.setAppUpdateAutoEnabled(false);

  await withStudy({ branch: BRANCHES.CONTROL }, async () => {
    await initUpdate(params);
    await withAddon(async () => {
      // Set up the "download and install" update state.
      await processUpdateSteps(preSteps);

      await doControlTest({
        searchString: SEARCH_STRINGS.UPDATE,
        tip: TIPS.UPDATE_ASK,
      });
    });
  });
});
