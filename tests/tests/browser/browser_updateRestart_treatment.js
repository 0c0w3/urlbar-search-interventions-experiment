/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Checks the UPDATE_RESTART tip on the treatment branch.
//
// The update parts of this test are adapted from:
// https://searchfox.org/mozilla-central/source/toolkit/mozapps/update/tests/browser/browser_aboutDialog_bc_downloaded_staged.js

"use strict";

let params = {
  queryString: "&invalidCompleteSize=1",
  backgroundUpdate: true,
  continueFile: CONTINUE_STAGING,
  waitForUpdateState: STATE_APPLIED,
};

let preSteps = [
  {
    panelId: "apply",
    checkActiveUpdate: { state: STATE_APPLIED },
    continueFile: null,
  },
];

add_task(async function test() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);

  // Enable the pref that automatically downloads and installs updates.
  await SpecialPowers.pushPrefEnv({
    set: [[PREF_APP_UPDATE_STAGING_ENABLED, true]],
  });

  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await initUpdate(params);
    await withAddon(async () => {
      // Set up the "apply" update state.
      await processUpdateSteps(preSteps);

      // Picking the tip should attempt to restart the browser.
      await doTreatmentTest({
        searchString: "update",
        tip: TIPS.UPDATE_RESTART,
        title: "The latest Firefox is downloaded and ready to install.",
        button: "Restart to Update",
        awaitCallback() {
          return TestUtils.topicObserved(
            "quit-application-requested",
            (cancelQuit, data) => {
              if (data == "restart") {
                cancelQuit.QueryInterface(Ci.nsISupportsPRBool).data = true;
                return true;
              }
              return false;
            }
          );
        },
      });
    });
  });
});
