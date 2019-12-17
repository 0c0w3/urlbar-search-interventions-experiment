/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * This class scores a query string against sets of keywords.  To refer to a
 * single set of keywords, we borrow the term "document" from search engine
 * terminology, and to refer to all documents, we borrow the term "corpus".  To
 * use this class, first add the documents in your corpus using `addDocument`,
 * and then call `score` with a query string.  `score` returns a sorted array of
 * document-score pairs.
 *
 * The scoring method is simple and is based on Levenshtein edit distance.
 * Therefore, lower scores indicate a better match than higher scores.  We first
 * split the query string into words.  For the first word, we compute the edit
 * distances between it and each word in the corpus.  For each subsequent word,
 * we compute the edit distances between it and each possible prefix of each
 * word in the corpus.  As we compute these distances for each word in the query
 * string, we keep a running sum per document of the minimum (best matching)
 * edit distances.  This sum a document's final score.  This class is designed
 * to score query strings as the user types them, which is why we match on
 * corpus prefixes for words in the query string after the first.
 *
 * As mentioned, `score` returns a sorted array of document-score pairs.  It's
 * up to you to filter the array to exclude scores above a certain threshold, or
 * to take the top scorer, etc.
 */
class QueryScorer {
  /**
   * @param {number} distanceThreshold
   *   When we compute the edit distances between a word in the query string and
   *   each word or prefix of a document, edit distances larger than this number
   *   force the score for that document to be Infinity -- i.e., no match.
   * @param {array} stopWords
   *   These words are ignored when they appear in the query string.  Similar to
   *   the prefix matching described above, we ignore the stop words exactly
   *   when they appear as the first word in a query.  For subsequent words in
   *   the query, we ignore all possible prefixes of the stop words.
   */
  constructor({ distanceThreshold = 1, stopWords = [] } = {}) {
    this.distanceThreshold = distanceThreshold;
    this.stopWords = stopWords;
    this._documents = new Set();
    this._documentsByWord = new Map();
    this._documentsByPrefix = new Map();
  }

  get distanceThreshold() {
    return this._distanceThreshold;
  }

  set distanceThreshold(value) {
    return (this._distanceThreshold = value);
  }

  get stopWords() {
    return this._stopWords;
  }

  set stopWords(array) {
    // _stopWords contains the stop words exactly.
    this._stopWords = new Set(array.map(word => word.toLocaleLowerCase()));

    // _stopWordPrefixes contains all possible prefixes of each stop word, up to
    // and including the whole word.
    this._stopWordPrefixes = new Set();
    for (let word of this._stopWords) {
      for (let i = 1; i <= word.length; i++) {
        this._stopWordPrefixes.add(word.substring(0, i));
      }
    }

    return this._stopWords;
  }

  /**
   * Adds a document to the scorer.
   *
   * @param {object} doc
   *   The document.
   * @param {string} doc.id
   *   The document's ID.
   * @param {array} doc.words
   *   The set of words in the document.
   */
  addDocument(doc) {
    this._documents.add(doc);

    doc.words = doc.words.map(word => word.toLocaleLowerCase());
    for (let word of doc.words) {
      // Update _documentsByWord, whose keys are the document's words exactly.
      let docs = this._documentsByWord.get(word) || new Set();
      docs.add(doc);
      this._documentsByWord.set(word, docs);

      // Update _documentsByPrefix, whose keys are all possible prefixes of the
      // document's words, up to and including the whole words.
      for (let i = 1; i <= word.length; i++) {
        let prefix = word.substring(0, i);
        let docs = this._documentsByPrefix.get(prefix) || new Set();
        docs.add(doc);
        this._documentsByPrefix.set(prefix, docs);
      }
    }
  }

  /**
   * Scores a query string against the documents in the scorer.
   *
   * @param {string} searchString
   *   The query string to score.
   * @returns {array}
   *   An array of objects: { document, score }.  Each element in the array is a
   *   a document and its score against the query string.  The elements are
   *   ordered by score from low to high.  Scores represent edit distance, so
   *   lower scores are better.
   */
  score(searchString) {
    // For each word in the query string:
    //
    // 1. Get its edit distance from all words in all documents.  While we're
    //    doing that, keep track of the word's minimum distance per document.
    // 2. For each document, add the minimum distance computed in the previous
    //    step to a running sum.  This sum is the document's distance score for
    //    the query string.

    let searchWords = searchString
      .trim()
      .split(/\s+/)
      .map(word => word.toLocaleLowerCase());
    let sumByDoc = new Map();
    for (let i = 0; i < searchWords.length; i++) {
      let searchWord = searchWords[i];
      if (
        (i == 0 && this.stopWords.has(searchWord)) ||
        (i > 0 && this._stopWordPrefixes.has(searchWord))
      ) {
        continue;
      }
      let minDistanceByDoc = new Map();
      let map = i == 0 ? this._documentsByWord : this._documentsByPrefix;
      for (let [docWord, docs] of map) {
        let distance = this._levenshtein(searchWord, docWord);
        if (distance > this.distanceThreshold) {
          distance = Infinity;
        }
        for (let doc of docs) {
          minDistanceByDoc.set(
            doc,
            Math.min(
              distance,
              minDistanceByDoc.has(doc) ? minDistanceByDoc.get(doc) : Infinity
            )
          );
        }
      }
      for (let [doc, min] of minDistanceByDoc) {
        sumByDoc.set(doc, min + (sumByDoc.get(doc) || 0));
      }
    }
    let results = [];
    for (let doc of this._documents) {
      let sum = sumByDoc.get(doc);
      results.push({
        document: doc,
        score: sum === undefined ? Infinity : sum,
      });
    }
    results.sort((a, b) => a.score - b.score);
    return results;
  }

  /**
   * [Copied from toolkit/modules/NLP.jsm]
   *
   * Calculate the Levenshtein distance between two words.
   * The implementation of this method was heavily inspired by
   * http://locutus.io/php/strings/levenshtein/index.html
   * License: MIT.
   *
   * @param  {String} word1   Word to compare against
   * @param  {String} word2   Word that may be different
   * @param  {Number} costIns The cost to insert a character
   * @param  {Number} costRep The cost to replace a character
   * @param  {Number} costDel The cost to delete a character
   * @return {Number}
   */
  _levenshtein(word1 = "", word2 = "", costIns = 1, costRep = 1, costDel = 1) {
    if (word1 === word2) {
      return 0;
    }

    let l1 = word1.length;
    let l2 = word2.length;
    if (!l1) {
      return l2 * costIns;
    }
    if (!l2) {
      return l1 * costDel;
    }

    let p1 = new Array(l2 + 1);
    let p2 = new Array(l2 + 1);

    let i1, i2, c0, c1, c2, tmp;

    for (i2 = 0; i2 <= l2; i2++) {
      p1[i2] = i2 * costIns;
    }

    for (i1 = 0; i1 < l1; i1++) {
      p2[0] = p1[0] + costDel;

      for (i2 = 0; i2 < l2; i2++) {
        c0 = p1[i2] + (word1[i1] === word2[i2] ? 0 : costRep);
        c1 = p1[i2 + 1] + costDel;

        if (c1 < c0) {
          c0 = c1;
        }

        c2 = p2[i2] + costIns;

        if (c2 < c0) {
          c0 = c2;
        }

        p2[i2 + 1] = c0;
      }

      tmp = p1;
      p1 = p2;
      p2 = tmp;
    }

    c0 = p1[l2];

    return c0;
  }
}
