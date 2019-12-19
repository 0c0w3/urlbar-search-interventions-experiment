/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global browser */

// The initial survey page shows a Next button that the user must click to start
// the survey.  The button is a submit button in a form, and we can add a
// listener on the window to listen for submit.
addEventListener(
  "submit",
  async () => {
    // The background script removes its listener the first time it receives
    // this message.  If we try to send again, sendMessage throws, and it shows
    // up in the browser console.  It doesn't actually matter in practice
    // because the add-on opens the survey page no more than once per session,
    // but it seems like good practice not to assume that.
    try {
      await browser.runtime.sendMessage("submit");
    } catch (ex) {}
  },
  { once: true }
);
