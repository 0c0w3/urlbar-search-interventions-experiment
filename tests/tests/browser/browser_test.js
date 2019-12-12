/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function init() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);
  makeProfileResettable();
});

// Tests the refresh tip on the treatment branch.
add_task(async function refresh_treatment() {
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      // Pick the tip, which should open the refresh dialog.  Click its cancel
      // button.
      await doTreatmentTest({
        searchString: "refresh",
        tip: TIPS.REFRESH,
        title:
          "Restore default settings and remove old add-ons for optimal performance.",
        button: "Refresh Firefox…",
        awaitCallback() {
          return BrowserTestUtils.promiseAlertDialog(
            "cancel",
            "chrome://global/content/resetProfile.xul"
          );
        },
      });
    });
  });
});

// Tests the refresh tip on the control branch.
add_task(async function refresh_control() {
  await withStudy({ branch: BRANCHES.CONTROL }, async () => {
    await withAddon(async () => {
      await doControlTest({
        searchString: "refresh",
        tip: TIPS.REFRESH,
      });
    });
  });
});

// Tests the clear tip on the treatment branch.
add_task(async function clear_treatment() {
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      // Pick the tip, which should open the refresh dialog.  Click its cancel
      // button.
      await doTreatmentTest({
        searchString: "clear",
        tip: TIPS.CLEAR,
        title: "Clear Firefox’s cache, cookies, history and more.",
        button: "Choose What to Clear…",
        awaitCallback() {
          return BrowserTestUtils.promiseAlertDialog(
            "cancel",
            "chrome://browser/content/sanitize.xul"
          );
        },
      });
    });
  });
});

// Tests the clear tip on the control branch.
add_task(async function clear_control() {
  await withStudy({ branch: BRANCHES.CONTROL }, async () => {
    await withAddon(async () => {
      await doControlTest({
        searchString: "clear",
        tip: TIPS.CLEAR,
      });
    });
  });
});

// Tests the clear tip on the treatment branch in a private window.  The clear
// tip shouldn't appear in private windows.
add_task(async function clear_treatment_private() {
  // Non-Mozilla-signed extensions are disabled in PBM by default, so if we're
  // testing an unsigned extension, this test would erroneously pass just
  // because no tips would appear at all.  Set this pref to make sure the
  // extension works in PBM.
  await SpecialPowers.pushPrefEnv({
    set: [["extensions.allowPrivateBrowsingByDefault", true]],
  });

  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      let win = await BrowserTestUtils.openNewBrowserWindow({ private: true });

      // First, make sure the extension works in PBM by triggering a non-clear
      // tip.
      let result = (await awaitTip("refresh", win))[0];
      Assert.strictEqual(result.payload.type, TIPS.REFRESH);

      // Blur the urlbar so that the engagement is ended.
      await UrlbarTestUtils.promisePopupClose(win, () => win.gURLBar.blur());

      // Now do a search that would trigger the clear tip.
      await awaitNoTip("clear", win);

      // Blur the urlbar so that the engagement is ended.
      await UrlbarTestUtils.promisePopupClose(win, () => win.gURLBar.blur());

      // The refresh tip should be recorded in telemetry, but the clear tip
      // should not.  Wait a moment before checking because the clear tip
      // telemetry would be recorded asyncly.
      // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
      await new Promise(r => setTimeout(r, 500));

      let scalars = TelemetryTestUtils.getProcessScalars("dynamic", true, true);

      // First, check the refresh tip using the telemetry helper.
      TelemetryTestUtils.assertKeyedScalar(
        scalars,
        TELEMETRY_SHOWN,
        TIPS.REFRESH,
        1
      );

      // Now check it without the helper.  There's no helper for checking for
      // the absence of telemetry, so we have to check for the absence of the
      // clear tip telemetry in this manner.  We want to make sure we're doing
      // it right.
      Assert.ok(TELEMETRY_SHOWN in scalars);
      Assert.ok(TIPS.REFRESH in scalars[TELEMETRY_SHOWN]);
      Assert.equal(scalars[TELEMETRY_SHOWN][TIPS.REFRESH], 1);

      // Finally, check the absence of the clear tip telemetry and picked
      // telemetry.
      Assert.ok(!(TIPS.CLEAR in scalars[TELEMETRY_SHOWN]));
      Assert.ok(!(TELEMETRY_PICKED in scalars));

      await BrowserTestUtils.closeWindow(win);
    });
  });

  await SpecialPowers.popPrefEnv();
});

// Makes sure engagement event telemetry is recorded on the treatment branch.
// We have a separate comprehensive test in the tree for engagement event
// telemetry, so we don't test everything here.  We only make sure that it's
// recorded.
add_task(async function eventTelemetry_treatment() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      // Start a search.
      await UrlbarTestUtils.promiseAutocompleteResultPopup({
        window,
        value: "test",
        waitForFocus,
        fireInputEvent: true,
      });

      // Blur the urlbar so that the engagement is ended.
      await UrlbarTestUtils.promisePopupClose(window, () => gURLBar.blur());

      TelemetryTestUtils.assertEvents([
        {
          category: "urlbar",
          method: "abandonment",
          object: "blur",
          value: "typed",
          extra: {
            elapsed: val => parseInt(val) > 0,
            numChars: "4",
          },
        },
      ]);
    });
  });
});

// Makes sure engagement event telemetry is recorded on the control branch.
add_task(async function eventTelemetry_control() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();
  await withStudy({ branch: BRANCHES.CONTROL }, async () => {
    await withAddon(async () => {
      // Start a search.
      await UrlbarTestUtils.promiseAutocompleteResultPopup({
        window,
        value: "test",
        waitForFocus,
        fireInputEvent: true,
      });

      // Blur the urlbar so that the engagement is ended.
      await UrlbarTestUtils.promisePopupClose(window, () => gURLBar.blur());

      TelemetryTestUtils.assertEvents([
        {
          category: "urlbar",
          method: "abandonment",
          object: "blur",
          value: "typed",
          extra: {
            elapsed: val => parseInt(val) > 0,
            numChars: "4",
          },
        },
      ]);
    });
  });
});

// Tests the survey web page on the treatment branch after picking a tip.
add_task(async function survey_treatmentPicked() {
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      await forceSurvey(FORCE_SURVEY_ENABLE);
      let tabPromise = BrowserTestUtils.waitForNewTab(gBrowser);
      await awaitTip("clear");
      await Promise.all([
        pickTip(),
        BrowserTestUtils.promiseAlertDialog(
          "cancel",
          "chrome://browser/content/sanitize.xul"
        ),
      ]);
      let tab = await tabPromise;
      Assert.equal(
        tab.linkedBrowser.currentURI.spec,
        "http://example.com/?b=treatment&action=picked&tip=clear"
      );
      BrowserTestUtils.removeTab(tab);
    });
  });
});

// Tests the survey web page on the treatment branch after ignoring a tip.
add_task(async function survey_treatmentIgnored() {
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      await forceSurvey(FORCE_SURVEY_ENABLE);
      let tabPromise = BrowserTestUtils.waitForNewTab(gBrowser);
      await awaitTip("clear");
      await UrlbarTestUtils.promisePopupClose(window, () => gURLBar.blur());
      let tab = await tabPromise;
      Assert.equal(
        tab.linkedBrowser.currentURI.spec,
        "http://example.com/?b=treatment&action=ignored&tip=clear"
      );
      BrowserTestUtils.removeTab(tab);
    });
  });
});

// Tests the survey web page on the control branch.
add_task(async function survey_control() {
  await withStudy({ branch: BRANCHES.CONTROL }, async () => {
    await withAddon(async () => {
      await forceSurvey(FORCE_SURVEY_ENABLE);
      let tabPromise = BrowserTestUtils.waitForNewTab(gBrowser);
      await awaitNoTip("clear");
      await UrlbarTestUtils.promisePopupClose(window, () => gURLBar.blur());
      let tab = await tabPromise;
      Assert.equal(
        tab.linkedBrowser.currentURI.spec,
        "http://example.com/?b=control&action=ignored&tip=clear"
      );
      BrowserTestUtils.removeTab(tab);
    });
  });
});

// The survey web page shouldn't be shown more than once per session.
add_task(async function survey_twice() {
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      await forceSurvey(FORCE_SURVEY_ENABLE);
      let tabPromise = BrowserTestUtils.waitForNewTab(gBrowser);
      await awaitTip("clear");
      await UrlbarTestUtils.promisePopupClose(window, () => gURLBar.blur());
      let tab = await tabPromise;
      Assert.equal(
        tab.linkedBrowser.currentURI.spec,
        "http://example.com/?b=treatment&action=ignored&tip=clear"
      );
      BrowserTestUtils.removeTab(tab);

      let count = gBrowser.tabs.length;
      Assert.equal(typeof count, "number", "Sanity check");
      await awaitTip("clear");
      await UrlbarTestUtils.promisePopupClose(window, () => gURLBar.blur());
      // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
      await new Promise(r => setTimeout(r, 1000));
      Assert.equal(count, gBrowser.tabs.length);
    });
  });
});

add_task(async function unenrollAfterInstall() {
  await withStudy({ branch: BRANCHES.TREATMENT }, async study => {
    await withAddon(async () => {
      await Promise.all([
        awaitAddonMessage("unenrolled"),
        AddonStudies.markAsEnded(study),
      ]);
      await awaitNoTip("refresh");
    });
  });
});

add_task(async function unenrollBeforeInstall() {
  await withStudy({ branch: BRANCHES.TREATMENT }, async study => {
    await AddonStudies.markAsEnded(study);
    await withAddon(async () => {
      await awaitNoTip("refresh");
    });
  });
});

add_task(async function noBranch() {
  await withStudy({}, async () => {
    await withAddon(async () => {
      await awaitNoTip("refresh");
    });
  });
});

add_task(async function unrecognizedBranch() {
  await withStudy({ branch: "bogus" }, async () => {
    await withAddon(async () => {
      await awaitNoTip("refresh");
    });
  });
});
