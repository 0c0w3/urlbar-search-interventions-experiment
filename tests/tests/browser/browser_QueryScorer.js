/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/* global QueryScorer */

"use strict";

const DISTANCE_THRESHOLD = 1;
const STOP_WORDS = ["stop"];

let documents = {
  fruits: "apple pear banana orange pomegranate",
  iceCreams: "chocolate vanilla butterscotch",
  animals: "aardvark badger hamster elephant",
};

let tests = [
  {
    query: "banana",
    matches: ["fruits"],
  },
  {
    query: "banan",
    matches: ["fruits"],
  },
  {
    query: "bana",
    matches: [],
  },
  {
    query: "banna",
    matches: ["fruits"],
  },
  {
    query: "banana apple",
    matches: ["fruits"],
  },
  {
    query: "banana appl",
    matches: ["fruits"],
  },
  {
    query: "banana app",
    matches: ["fruits"],
  },
  {
    query: "banana ap",
    matches: ["fruits"],
  },
  {
    query: "banana a",
    matches: ["fruits"],
  },
  {
    query: "banana aple",
    matches: ["fruits"],
  },
  {
    query: "banana apl",
    matches: ["fruits"],
  },
  {
    query: "banana al",
    matches: ["fruits"],
  },
  {
    query: "banana all",
    matches: [],
  },

  {
    query: "vanilla",
    matches: ["iceCreams"],
  },
  {
    query: "vanill",
    matches: ["iceCreams"],
  },
  {
    query: "vanil",
    matches: [],
  },
  {
    query: "vanila",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla butterscotch",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla butterscotc",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla butterscot",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla buttersco",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla butersco",
    matches: ["iceCreams"],
  },
  {
    query: "vanilla buersco",
    matches: [],
  },

  {
    query: "aardvark",
    matches: ["animals"],
  },
  {
    query: "aardvar",
    matches: ["animals"],
  },
  {
    query: "aardva",
    matches: [],
  },
  {
    query: "ardvark",
    matches: ["animals"],
  },
  {
    query: "aardvark hamster",
    matches: ["animals"],
  },
  {
    query: "aardvark hamste",
    matches: ["animals"],
  },
  {
    query: "aardvark hamst",
    matches: ["animals"],
  },
  {
    query: "aardvark hams",
    matches: ["animals"],
  },
  {
    query: "aardvark has",
    matches: ["animals"],
  },
  {
    query: "aardvark hass",
    matches: ["animals"],
  },
  {
    query: "aardvark hasss",
    matches: [],
  },

  {
    query: "banana aardvark",
    matches: [],
  },

  {
    query: "banana stop",
    matches: ["fruits"],
  },
  {
    query: "banana sto",
    matches: ["fruits"],
  },
  {
    query: "banana st",
    matches: ["fruits"],
  },
  {
    query: "banana s",
    matches: ["fruits"],
  },
  {
    query: "banana stop apple",
    matches: ["fruits"],
  },
  {
    query: "stop b",
    matches: ["fruits", "iceCreams", "animals"],
  },
  {
    query: "stop ban",
    matches: ["fruits", "iceCreams", "animals"],
  },
  {
    query: "stop bana",
    matches: ["fruits"],
  },
  {
    query: "stop banana",
    matches: ["fruits"],
  },
];

add_task(async function init() {
  await initAddonTest(ADDON_PATH, EXPECTED_ADDON_SIGNED_STATE);
});

add_task(async function test() {
  await withAddon(async addon => {
    let fileURI = addon.getResourceURI("QueryScorer.js");
    Services.scriptloader.loadSubScript(fileURI.spec);

    let qs = new QueryScorer({
      distanceThreshold: DISTANCE_THRESHOLD,
      stopWords: STOP_WORDS,
    });

    for (let [id, words] of Object.entries(documents)) {
      qs.addDocument({ id, words: words.split(/\s+/) });
    }

    for (let { query, matches } of tests) {
      info(`Checking query: ${query}`);
      let actual = qs
        .score(query)
        .filter(result => result.score <= DISTANCE_THRESHOLD)
        .map(result => result.document.id);
      Assert.deepEqual(actual, matches);
    }
  });
});
