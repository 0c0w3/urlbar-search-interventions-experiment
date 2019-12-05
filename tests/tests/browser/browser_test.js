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
  await withStudy({ branch: BRANCHES.TREATMENT }, async () => {
    await withAddon(async () => {
      let win = await BrowserTestUtils.openNewBrowserWindow({ private: true });

      // Do a search that would trigger the tip.
      await awaitNoTip("clear", win);

      // Blur the urlbar so that the engagement is ended.
      await UrlbarTestUtils.promisePopupClose(win, () => win.gURLBar.blur());

      // Telemetry shouldn't be updated.  Wait a moment before checking because
      // the telemetry would be recorded asyncly.
      // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
      await new Promise(r => setTimeout(r, 500));

      let scalars = TelemetryTestUtils.getProcessScalars("dynamic", true, true);
      Assert.ok(!(TELEMETRY_SHOWN in scalars));
      Assert.ok(!(TELEMETRY_PICKED in scalars));

      await BrowserTestUtils.closeWindow(win);
    });
  });
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
