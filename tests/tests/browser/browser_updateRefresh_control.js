/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Checks the UPDATE_REFRESH tip on the control branch.
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
  await withStudy({ branch: BRANCHES.CONTROL }, async () => {
    await initUpdate(params);
    await withAddon(async () => {
      // Set up the "no updates" update state.
      await processUpdateSteps(preSteps);

      await doControlTest({
        searchString: SEARCH_STRINGS.UPDATE,
        tip: TIPS.UPDATE_REFRESH,
      });
    });
  });
});
