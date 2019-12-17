/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Checks the UPDATE_REFRESH tip on the treatment branch.
//
// The update parts of this test are adapted from:
// https://searchfox.org/mozilla-central/source/toolkit/mozapps/update/tests/browser/browser_aboutDialog_fc_check_noUpdate.js

"use strict";

let params = { queryString: "&noUpdates=1" };

let preSteps = [
  {
    panelId: "checkingForUpdates",
    checkActiveUpdate: null,
    continueFile: CONTINUE_CHECK,
  },
  {
    panelId: "noUpdatesFound",
    checkActiveUpdate: null,
    continueFile: null,
  },
];

add_task(async function test() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);
  makeProfileResettable();
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await initUpdate(params);
    await withAddon(async () => {
      // Set up the "no updates" update state.
      await processUpdateSteps(preSteps);

      // Picking the tip should open the refresh dialog.  Click its cancel
      // button.
      await doTreatmentTest({
        searchString: "update",
        tip: TIPS.UPDATE_REFRESH,
        title:
          "Firefox is up to date. Trying to fix a problem? Restore default settings and remove old add-ons for optimal performance.",
        button: "Refresh Firefox…",
        awaitCallback() {
          return promiseAlertDialog("cancel", [
            "chrome://global/content/resetProfile.xhtml",
            "chrome://global/content/resetProfile.xul",
          ]);
        },
      });
    });
  });
});
