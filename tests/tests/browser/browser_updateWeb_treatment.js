/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Checks the UPDATE_WEB tip on the treatment branch.
//
// The update parts of this test are adapted from:
// https://searchfox.org/mozilla-central/source/toolkit/mozapps/update/tests/browser/browser_aboutDialog_fc_check_unsupported.js

"use strict";

let params = { queryString: "&unsupported=1" };

let preSteps = [
  {
    panelId: "checkingForUpdates",
    checkActiveUpdate: null,
    continueFile: CONTINUE_CHECK,
  },
  {
    panelId: "unsupportedSystem",
    checkActiveUpdate: null,
    continueFile: null,
  },
];

add_task(async function test() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await initUpdate(params);
    await withAddon(async () => {
      // Force a check to get the ball running.
      let checker = Cc["@mozilla.org/updates/update-checker;1"].getService(
        Ci.nsIUpdateChecker
      );
      checker.checkForUpdates({}, true);

      // Set up the "unsupported update" update state.
      await processUpdateSteps(preSteps);

      // Picking the tip should open the download page in a new tab.
      let downloadTab = await doTreatmentTest({
        searchString: "update",
        tip: TIPS.UPDATE_WEB,
        title: "Get the latest Firefox browser.",
        button: "Download Now",
        awaitCallback() {
          return BrowserTestUtils.waitForNewTab(
            gBrowser,
            "https://www.mozilla.org/firefox/new/"
          );
        },
      });

      Assert.equal(gBrowser.selectedTab, downloadTab);
      BrowserTestUtils.removeTab(downloadTab);
    });
  });
});
