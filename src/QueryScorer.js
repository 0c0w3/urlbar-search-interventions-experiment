/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * This class scores a query string against sets of phrases.  To refer to a
 * single set of phrases, we borrow the term "document" from search engine
 * terminology.  To use this class, first add your documents with `addDocument`,
 * and then call `score` with a query string.  `score` returns a sorted array of
 * document-score pairs.
 *
 * The scoring method is fairly simple and is based on Levenshtein edit
 * distance.  Therefore, lower scores indicate a better match than higher
 * scores.  In summary, a query matches a phrase if the query starts with the
 * phrase.  So a query "firefox update foo bar" matches the phrase "firefox
 * update" for example.  A query matches a document if it matches any phrase in
 * the document.  The query and phrases are compared word for word, and we allow
 * fuzzy matching by computing the Levenshtein edit distance in each comparison.
 * The amount of fuzziness allowed is controlled with `distanceThreshold`.  If
 * the distance in a comparison is greater than this threshold, then the phrase
 * does not match the query.  The final score for a document is the minimum edit
 * distance between its phrases and the query.
 *
 * As mentioned, `score` returns a sorted array of document-score pairs.  It's
 * up to you to filter the array to exclude scores above a certain threshold, or
 * to take the top scorer, etc.
 */
class QueryScorer {
  /**
   * @param {number} distanceThreshold
   *   Edit distances no larger than this value are considered matches.
   * @param {Map} variations
   *   For convenience, the scorer can augment documents by replacing certain
   *   words with other words and phrases. This mechanism is called variations.
   *   This keys of this map are words that should be replaced, and the values
   *   are the replacement words or phrases.  For example, if you add a document
   *   whose only phrase is "firefox update", normally the scorer will register
   *   only this single phrase for the document.  However, if you pass the value
   *   `new Map(["firefox", ["fire fox", "fox fire", "foxfire"]])` for this
   *   parameter, it will register 4 total phrases for the document: "fire fox
   *   update", "fox fire update", "foxfire update", and the original "firefox
   *   update".
   */
  constructor({ distanceThreshold = 1, variations = new Map() } = {}) {
    this._distanceThreshold = distanceThreshold;
    this._variations = variations;
    this._documents = new Set();
    this._rootNode = new Node();
  }

  /**
   * Adds a document to the scorer.
   *
   * @param {object} doc
   *   The document.
   * @param {string} doc.id
   *   The document's ID.
   * @param {array} doc.phrases
   *   The set of phrases in the document.  Each phrase should be a string.
   */
  addDocument(doc) {
    this._documents.add(doc);

    for (let phraseStr of doc.phrases) {
      // Split the phrase and lowercase the words.
      let phrase = phraseStr
        .trim()
        .split(/\s+/)
        .map(word => word.toLocaleLowerCase());

      // Build a phrase list that contains the original phrase plus its
      // variations, if any.
      let phrases = [phrase];
      for (let [triggerWord, variations] of this._variations) {
        let index = phrase.indexOf(triggerWord);
        if (index >= 0) {
          for (let variation of variations) {
            let variationPhrase = Array.from(phrase);
            variationPhrase.splice(index, 1, ...variation.split(/\s+/));
            phrases.push(variationPhrase);
          }
        }
      }

      // Finally, add the phrases to the phrase tree.
      for (let phrase of phrases) {
        this._buildPhraseTree(this._rootNode, doc, phrase, 0);
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
  score(queryString) {
    let queryWords = queryString
      .trim()
      .split(/\s+/)
      .map(word => word.toLocaleLowerCase());
    let minDistanceByDoc = this._traverse({ queryWords });
    let results = [];
    for (let doc of this._documents) {
      let distance = minDistanceByDoc.get(doc);
      results.push({
        document: doc,
        score: distance === undefined ? Infinity : distance,
      });
    }
    results.sort((a, b) => a.score - b.score);
    return results;
  }

  /**
   * Builds the phrase tree based on the current documents.
   *
   * The phrase tree lets us efficiently match queries against phrases.  Each
   * path through the tree starting from the root and ending at a leaf
   * represents a complete phrase in a document (or more than one document, if
   * the same phrase is present in multiple documents).  Each node in the path
   * represents a word in the phrase.  To match a query, we start at the root,
   * and in the root we look up the query's first word.  If the word matches the
   * first word of any phrase, then the root will have a child node representing
   * that word, and we move on to the child node.  Then we look up the query's
   * second word in the child node, and so on, until either a lookup fails or we
   * reach a leaf node.
   *
   * @param {Node} node
   *   The current node being visited.
   * @param {object} doc
   *   The document whose phrases are being added to the tree.
   * @param {array} phrase
   *   The phrase to add to the tree.
   * @param {number} wordIndex
   *   The index in the phrase of the current word.
   */
  _buildPhraseTree(node, doc, phrase, wordIndex) {
    if (phrase.length == wordIndex) {
      // We're done with this phrase.
      return;
    }

    let word = phrase[wordIndex].toLocaleLowerCase();
    let child = node.childrenByWord.get(word);
    if (!child) {
      child = new Node(word);
      node.childrenByWord.set(word, child);
    }
    child.documents.add(doc);

    // Recurse with the next word in the phrase.
    this._buildPhraseTree(child, doc, phrase, wordIndex + 1);
  }

  /**
   * Traverses a path in the phrase tree in order to score a query.  See
   * `_buildPhraseTree` for a description of how this works.
   *
   * @param {array} queryWords
   *   The query being scored, split into words.
   * @param {Node} node
   *   The node currently being visited.
   * @param {Map} minDistanceByDoc
   *   Keeps track of the minimum edit distance for each document as the
   *   traversal continues.
   * @param {number} queryWordsIndex
   *   The current index in the query words array.
   * @param {number} phraseDistance
   *   The total edit distance between the query and the path in the tree that's
   *   been traversed so far.
   * @return {Map} minDistanceByDoc
   */
  _traverse({
    queryWords,
    node = this._rootNode,
    minDistanceByDoc = new Map(),
    queryWordsIndex = 0,
    phraseDistance = 0,
  } = {}) {
    if (!node.childrenByWord.size) {
      // We reached a leaf node.  The query has matched a phrase.  If the query
      // and the phrase have the same number of words, then queryWordsIndex ==
      // queryWords.length also.  Otherwise the query contains more words than
      // the phrase.  We still count that as a match.
      for (let doc of node.documents) {
        minDistanceByDoc.set(
          doc,
          Math.min(
            phraseDistance,
            minDistanceByDoc.has(doc) ? minDistanceByDoc.get(doc) : Infinity
          )
        );
      }
      return minDistanceByDoc;
    }

    if (queryWordsIndex == queryWords.length) {
      // We exhausted all the words in the query but have not reached a leaf
      // node.  No match; the query has matched a phrase(s) up to this point,
      // but it doesn't have enough words.
      return minDistanceByDoc;
    }

    // Compare each word in the node to the current query word.
    let queryWord = queryWords[queryWordsIndex];
    for (let [childWord, child] of node.childrenByWord) {
      let distance = this._levenshtein(queryWord, childWord);
      if (distance <= this._distanceThreshold) {
        // The word represented by this child node matches the current query
        // word.  Recurse into the child node.
        this._traverse({
          node: child,
          queryWords,
          queryWordsIndex: queryWordsIndex + 1,
          phraseDistance: phraseDistance + distance,
          minDistanceByDoc,
        });
      }
      // Else, the path that continues at the child node can't possibly match
      // the query, so don't recurse into it.
    }

    return minDistanceByDoc;
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

/**
 * A node in the scorer's phrase tree.
 */
class Node {
  constructor(word) {
    this.word = word;
    this.documents = new Set();
    this.childrenByWord = new Map();
  }
}
