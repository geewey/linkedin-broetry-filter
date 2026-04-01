(() => {
  'use strict';

  let filterEnabled = true;
  let sensitivity = 2;
  let compressedBroetryEnabled = false;
  let hiddenCount = 0;
  let scannedCount = 0;
  let autoLoadMore = false;
  let processedPosts = new WeakSet();
  let contextValid = true;

  // ─── Debug ──────────────────────────────────────────────────────────

  function log(...args) {
    console.log('%c[Broetry]', 'color: #e63946; font-weight: bold;', ...args);
  }

  // ─── Safe Chrome API wrapper ────────────────────────────────────────

  function safeStorageSet(data) {
    try {
      if (contextValid && chrome?.storage?.local) {
        chrome.storage.local.set(data);
      }
    } catch (e) {
      if (e.message.includes('Extension context invalidated')) {
        contextValid = false;
        cleanup();
      }
    }
  }

  function safeStorageGet(keys, callback) {
    try {
      if (contextValid && chrome?.storage?.local) {
        chrome.storage.local.get(keys, callback);
      }
    } catch (e) {
      if (e.message.includes('Extension context invalidated')) {
        contextValid = false;
        cleanup();
      }
    }
  }

  // ─── Broetry Detection ──────────────────────────────────────────────

  function scoreBroetry(text) {
    if (!text || text.trim().length < 20) return { score: 0, reason: 'too short' };

    // Normalize smart/curly quotes to straight quotes for reliable matching
    const lowerText = text.toLowerCase().replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');

    // ── Exemptions: content that has short lines but isn't broetry ──

    // Job postings / hiring posts
    const strongJobSignals = ['i\'m hiring', 'i am hiring', 'we\'re hiring', 'we are hiring',
      'i\'m recruiting', 'we\'re recruiting', '#hiring', 'yay, i\'m', 'link to apply'];
    const hasStrongJobSignal = strongJobSignals.some(s => lowerText.includes(s));
    if (hasStrongJobSignal) return { score: 0, reason: 'job posting (exempt)' };

    const jobSignals = ['hiring for', 'looking for', 'open role', 'open position',
      'apply now', 'apply here', 'link to role', 'check out the role',
      'join our team', 'join my team', 'job opening', 'job description',
      'tech stack includes', 'tech stack:', 'requirements:', 'qualifications:',
      'roles open', 'roles below', 'roles available', 'great opportunity',
      'come work with', 'looking to hire', 'looking for engineers', 'looking for a',
      'great fit', 'dm me', 'reach out if', 'here\'s a link to apply',
      'developer roles', 'engineer roles', 'greenfield project',
      'work on containers', 'senior/staff', 'staff/principal'];
    const jobHits = jobSignals.filter(s => lowerText.includes(s)).length;
    if (jobHits >= 2) return { score: 0, reason: 'job posting (exempt)' };

    // Technical content with code/config patterns
    const codeSignals = ['```', 'const ', 'function ', 'import ', 'return ',
      'npm install', 'pip install', '$ ', '.env', 'api/', 'http://', 'https://',
      '=>', '===', '!=='];
    const codeHits = codeSignals.filter(s => text.includes(s)).length;
    if (codeHits >= 3) return { score: 0, reason: 'code content (exempt)' };

    // Lists with bullet points, numbered items, or emoji markers
    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
    const bulletLines = lines.filter(l => /^[\-•·▸▹➤✅❌🔹🔸✔️☑️\d]+[\.\):]?\s/.test(l)).length;
    if (bulletLines >= 3) return { score: 0, reason: 'structured list (exempt)' };

    // Event listings / schedules — lines starting with calendar emoji or date patterns
    const dateLines = lines.filter(l =>
      /^🗓️|^📅|^📆|^🗓/.test(l) ||
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d/i.test(l) ||
      /^\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(l)
    ).length;
    if (dateLines >= 2) return { score: 0, reason: 'event listing (exempt)' };

    // URL-heavy posts (event roundups, resource lists, etc.)
    const urlLines = lines.filter(l => /https?:\/\//.test(l)).length;
    if (urlLines >= 3) return { score: 0, reason: 'URL-heavy post (exempt)' };

    const totalLines = lines.length;
    if (totalLines < 4) return { score: 0, reason: `only ${totalLines} lines` };

    // Filter out lines that are just URLs or hashtags — these inflate
    // short-line counts but aren't broetry indicators
    const contentLines = lines.filter(l =>
      !/^https?:\/\/\S+$/.test(l) &&   // URL-only line
      !/^#\w+$/.test(l) &&              // hashtag-only line
      !/^👇$/.test(l) &&                // pointing-down emoji only
      l.length > 0
    );

    if (contentLines.length < 4) return { score: 0, reason: `only ${contentLines.length} content lines after filtering` };

    const wordsPerLine = contentLines.map(l => l.split(/\s+/).filter(w => w.length > 0).length);
    const totalWords = wordsPerLine.reduce((a, b) => a + b, 0);

    const shortLines = wordsPerLine.filter(w => w <= 5).length;
    const veryShortLines = wordsPerLine.filter(w => w <= 2).length;
    const singleWordLines = wordsPerLine.filter(w => w === 1).length;
    const avgWordsPerLine = totalWords / contentLines.length;

    const shortLineRatio = shortLines / contentLines.length;
    const veryShortLineRatio = veryShortLines / contentLines.length;
    const singleWordRatio = singleWordLines / contentLines.length;

    const dramaticEndings = contentLines.filter(l => {
      const words = l.split(/\s+/).length;
      return words <= 3 && /[.!]$/.test(l);
    }).length;
    const dramaticRatio = dramaticEndings / contentLines.length;

    const punchLines = contentLines.filter(l => /^\w+[.!]?$/.test(l)).length;

    let score = 0;
    const breakdown = [];

    if (shortLineRatio > 0.7) { score += 3; breakdown.push(`shortLineRatio ${shortLineRatio.toFixed(2)} → +3`); }
    else if (shortLineRatio > 0.5) { score += 2; breakdown.push(`shortLineRatio ${shortLineRatio.toFixed(2)} → +2`); }
    else if (shortLineRatio > 0.35) { score += 1; breakdown.push(`shortLineRatio ${shortLineRatio.toFixed(2)} → +1`); }

    if (veryShortLineRatio > 0.5) { score += 3; breakdown.push(`veryShortRatio ${veryShortLineRatio.toFixed(2)} → +3`); }
    else if (veryShortLineRatio > 0.3) { score += 2; breakdown.push(`veryShortRatio ${veryShortLineRatio.toFixed(2)} → +2`); }
    else if (veryShortLineRatio > 0.2) { score += 1; breakdown.push(`veryShortRatio ${veryShortLineRatio.toFixed(2)} → +1`); }

    if (singleWordRatio > 0.3) { score += 3; breakdown.push(`singleWordRatio ${singleWordRatio.toFixed(2)} → +3`); }
    else if (singleWordRatio > 0.15) { score += 2; breakdown.push(`singleWordRatio ${singleWordRatio.toFixed(2)} → +2`); }
    else if (singleWordRatio > 0.08) { score += 1; breakdown.push(`singleWordRatio ${singleWordRatio.toFixed(2)} → +1`); }

    if (avgWordsPerLine < 4) { score += 3; breakdown.push(`avgWords ${avgWordsPerLine.toFixed(1)} → +3`); }
    else if (avgWordsPerLine < 6) { score += 2; breakdown.push(`avgWords ${avgWordsPerLine.toFixed(1)} → +2`); }
    else if (avgWordsPerLine < 8) { score += 1; breakdown.push(`avgWords ${avgWordsPerLine.toFixed(1)} → +1`); }

    if (dramaticRatio > 0.3) { score += 2; breakdown.push(`dramaticRatio ${dramaticRatio.toFixed(2)} → +2`); }
    else if (dramaticRatio > 0.15) { score += 1; breakdown.push(`dramaticRatio ${dramaticRatio.toFixed(2)} → +1`); }

    if (punchLines >= 3) { score += 2; breakdown.push(`punchLines ${punchLines} → +2`); }
    else if (punchLines >= 2) { score += 1; breakdown.push(`punchLines ${punchLines} → +1`); }

    if (contentLines.length > 8 && avgWordsPerLine < 5) { score += 2; breakdown.push(`longPost+shortLines → +2`); }

    if (contentLines.length >= 5 && wordsPerLine[wordsPerLine.length - 1] <= 2 && wordsPerLine[0] >= 3) {
      score += 1; breakdown.push(`storyArc → +1`);
    }

    const threshold = { 1: 9, 2: 7, 3: 5 }[sensitivity];

    return {
      score,
      threshold,
      isBroetry: score >= threshold,
      totalLines: contentLines.length,
      avgWordsPerLine: avgWordsPerLine.toFixed(1),
      breakdown,
      lines: contentLines.slice(0, 5),
    };
  }

  // ─── Compressed Broetry Detection ────────────────────────────────
  // Detects broetry that's been squashed into paragraphs but still
  // uses very short sentences. Analyzes sentence length (by periods)
  // rather than line breaks.

  function scoreCompressedBroetry(text) {
    if (!text || text.trim().length < 100) return { score: 0, reason: 'too short for compressed check' };

    const lowerText = text.toLowerCase().replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');

    // Skip exempted content (same checks as regular broetry)
    const strongJobSignals = ['i\'m hiring', 'i am hiring', 'we\'re hiring', 'we are hiring',
      'i\'m recruiting', 'we\'re recruiting', '#hiring', 'yay, i\'m', 'link to apply'];
    if (strongJobSignals.some(s => lowerText.includes(s))) return { score: 0, reason: 'job posting (exempt)' };
    if (lowerText.includes('promoted by') || lowerText.includes('sponsored')) return { score: 0, reason: 'promoted (exempt)' };

    // Split text into sentences by period, exclamation, question mark
    // Filter out URLs, numbers-only, abbreviations
    const rawSentences = text
      .replace(/https?:\/\/\S+/g, '') // remove URLs
      .replace(/\.\.\./g, '…')        // protect ellipsis
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 2 && !/^\d+$/.test(s));

    const totalSentences = rawSentences.length;
    if (totalSentences < 6) return { score: 0, reason: `only ${totalSentences} sentences` };

    const wordsPerSentence = rawSentences.map(s => s.split(/\s+/).filter(w => w.length > 0).length);
    const totalWords = wordsPerSentence.reduce((a, b) => a + b, 0);
    const avgWordsPerSentence = totalWords / totalSentences;

    const shortSentences = wordsPerSentence.filter(w => w <= 6).length;
    const veryShortSentences = wordsPerSentence.filter(w => w <= 3).length;

    const shortSentenceRatio = shortSentences / totalSentences;
    const veryShortSentenceRatio = veryShortSentences / totalSentences;

    // Dramatic fragments: sentences that are 1-3 words and feel punchy
    const dramaticFragments = rawSentences.filter(s => {
      const words = s.split(/\s+/).filter(w => w.length > 0).length;
      return words <= 3 && words >= 1;
    }).length;
    const dramaticRatio = dramaticFragments / totalSentences;

    let score = 0;
    const breakdown = [];

    // Short sentence ratio
    if (shortSentenceRatio > 0.6) { score += 3; breakdown.push(`shortSentRatio ${shortSentenceRatio.toFixed(2)} → +3`); }
    else if (shortSentenceRatio > 0.4) { score += 2; breakdown.push(`shortSentRatio ${shortSentenceRatio.toFixed(2)} → +2`); }
    else if (shortSentenceRatio > 0.3) { score += 1; breakdown.push(`shortSentRatio ${shortSentenceRatio.toFixed(2)} → +1`); }

    // Very short sentence ratio
    if (veryShortSentenceRatio > 0.35) { score += 3; breakdown.push(`veryShortSentRatio ${veryShortSentenceRatio.toFixed(2)} → +3`); }
    else if (veryShortSentenceRatio > 0.2) { score += 2; breakdown.push(`veryShortSentRatio ${veryShortSentenceRatio.toFixed(2)} → +2`); }
    else if (veryShortSentenceRatio > 0.1) { score += 1; breakdown.push(`veryShortSentRatio ${veryShortSentenceRatio.toFixed(2)} → +1`); }

    // Average words per sentence
    if (avgWordsPerSentence < 6) { score += 3; breakdown.push(`avgWPS ${avgWordsPerSentence.toFixed(1)} → +3`); }
    else if (avgWordsPerSentence < 9) { score += 2; breakdown.push(`avgWPS ${avgWordsPerSentence.toFixed(1)} → +2`); }
    else if (avgWordsPerSentence < 12) { score += 1; breakdown.push(`avgWPS ${avgWordsPerSentence.toFixed(1)} → +1`); }

    // Dramatic fragment ratio
    if (dramaticRatio > 0.25) { score += 2; breakdown.push(`dramaticFragRatio ${dramaticRatio.toFixed(2)} → +2`); }
    else if (dramaticRatio > 0.15) { score += 1; breakdown.push(`dramaticFragRatio ${dramaticRatio.toFixed(2)} → +1`); }

    // High sentence count with low avg words = classic compressed broetry
    if (totalSentences > 10 && avgWordsPerSentence < 10) { score += 2; breakdown.push(`manySentences+short → +2`); }

    // Story arc: first sentence longer, last sentence very short
    if (totalSentences >= 5 && wordsPerSentence[wordsPerSentence.length - 1] <= 4 && wordsPerSentence[0] >= 5) {
      score += 1; breakdown.push(`sentenceArc → +1`);
    }

    const threshold = { 1: 11, 2: 8, 3: 6 }[sensitivity];

    return {
      score,
      threshold,
      isCompressedBroetry: score >= threshold,
      totalSentences,
      avgWordsPerSentence: avgWordsPerSentence.toFixed(1),
      breakdown,
      sentences: rawSentences.slice(0, 5),
    };
  }

  // ─── Post Finding ──────────────────────────────────────────────────

  function findFeedPosts() {
    const found = new Set();
    const debugInfo = { strategy: 'none', details: {} };

    // Strategy 1: role="listitem" with h2 containing "Feed post"
    const listItems = document.querySelectorAll('[role="listitem"][componentkey]');
    debugInfo.details.listItemsWithComponentkey = listItems.length;

    listItems.forEach(el => {
      const h2 = el.querySelector('h2');
      if (h2) {
        const srText = h2.textContent.trim().toLowerCase();
        if (srText.includes('feed post') || srText.includes('feed update')) {
          found.add(el);
        }
      }
    });

    if (found.size > 0) {
      debugInfo.strategy = '1: role=listitem + h2 "Feed post"';
      debugInfo.details.found = found.size;
      return { posts: Array.from(found), debugInfo };
    }

    // Strategy 2: Walk up from data-testid="expandable-text-box"
    const textBoxes = document.querySelectorAll('[data-testid="expandable-text-box"]');
    debugInfo.details.expandableTextBoxes = textBoxes.length;

    textBoxes.forEach(tb => {
      const listItem = tb.closest('[role="listitem"]');
      if (listItem) found.add(listItem);
    });

    if (found.size > 0) {
      debugInfo.strategy = '2: expandable-text-box → listitem';
      debugInfo.details.found = found.size;
      return { posts: Array.from(found), debugInfo };
    }

    // Strategy 3: Any role="listitem" with substantial content
    const allListItems = document.querySelectorAll('[role="listitem"]');
    debugInfo.details.allListItems = allListItems.length;

    allListItems.forEach(el => {
      if (el.textContent.length > 100) {
        found.add(el);
      }
    });

    if (found.size > 0) {
      debugInfo.strategy = '3: any listitem with content';
      debugInfo.details.found = found.size;
      return { posts: Array.from(found), debugInfo };
    }

    // Strategy 4: Broadest — any element with componentkey containing text
    const allComponentKeys = document.querySelectorAll('[componentkey]');
    debugInfo.details.allComponentKeys = allComponentKeys.length;

    // Nothing found — dump a DOM snapshot to help diagnose
    debugInfo.strategy = 'NONE — all strategies failed';
    debugInfo.details.found = 0;

    return { posts: [], debugInfo };
  }

  function getPostText(postElement) {
    let text = '';
    let extractionMethod = 'none';

    // Strategy 1: data-testid="expandable-text-box"
    // LinkedIn puts expandable-text-box on BOTH the main post AND comments.
    // The main post text is always the LONGEST one, and typically the first
    // one that ISN'T inside a comment section.
    // Comment sections have componentkeys containing "comment" or are inside
    // elements with data-testid containing "commentList".
    const allTextBoxes = postElement.querySelectorAll('[data-testid="expandable-text-box"]');
    if (allTextBoxes.length > 0) {
      // Find the longest expandable-text-box — that's the main post, not a comment
      let bestBox = null;
      let bestLen = 0;
      for (const box of allTextBoxes) {
        const len = box.textContent.trim().length;
        if (len > bestLen) {
          bestLen = len;
          bestBox = box;
        }
      }

      if (bestBox) {
        const clone = bestBox.cloneNode(true);
        // Remove any nested buttons (like "...more" buttons)
        clone.querySelectorAll('button').forEach(btn => btn.remove());
        clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        clone.querySelectorAll('p, div').forEach(el => {
          el.prepend(document.createTextNode('\n'));
          el.append(document.createTextNode('\n'));
        });
        text = clone.textContent;
        extractionMethod = `expandable-text-box (${allTextBoxes.length} found, picked longest: ${bestLen} chars)`;
      }
    }

    // Strategy 2: <p> with componentkey
    if (!text.trim()) {
      const paragraphs = postElement.querySelectorAll('p[componentkey]');
      for (const p of paragraphs) {
        if (p.textContent.length > 50) {
          const clone = p.cloneNode(true);
          clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
          text += clone.textContent + '\n';
          extractionMethod = 'p[componentkey]';
        }
      }
    }

    // Strategy 3: Longest text span
    if (!text.trim()) {
      let longestSpan = null;
      let longestLen = 0;
      postElement.querySelectorAll('span').forEach(span => {
        const len = span.textContent.trim().length;
        if (len > longestLen && len > 50) {
          longestLen = len;
          longestSpan = span;
        }
      });
      if (longestSpan) {
        const clone = longestSpan.cloneNode(true);
        clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        text = clone.textContent;
        extractionMethod = 'longest-span';
      }
    }

    return { text, extractionMethod };
  }

  // ─── DOM Manipulation ───────────────────────────────────────────────

  function getPostAuthor(postElement) {
    // Try aria-label on the profile link (e.g. "View John Doe's profile")
    const profileLink = postElement.querySelector('a[aria-label*="profile" i] img[alt]');
    if (profileLink) {
      const alt = profileLink.getAttribute('alt');
      const match = alt.match(/^View (.+?)['']s profile/i) || alt.match(/^View (.+)/i);
      if (match) return match[1].trim();
    }

    // Try the img alt directly
    const imgs = postElement.querySelectorAll('figure img[alt]');
    for (const img of imgs) {
      const alt = img.getAttribute('alt');
      const match = alt.match(/^View (.+?)['']s profile/i);
      if (match) return match[1].trim();
    }

    return 'Unknown';
  }

  function getBroetryReason(result) {
    if (!result.breakdown?.length) return 'dramatic one-liner style';
    const reasons = [];
    if (result.breakdown.some(b => b.includes('shortLineRatio'))) reasons.push('many short lines');
    if (result.breakdown.some(b => b.includes('singleWordRatio'))) reasons.push('single-word lines');
    if (result.breakdown.some(b => b.includes('veryShortRatio'))) reasons.push('very short lines');
    if (result.breakdown.some(b => b.includes('avgWords'))) reasons.push('low words per line');
    if (result.breakdown.some(b => b.includes('dramaticRatio'))) reasons.push('dramatic endings');
    if (result.breakdown.some(b => b.includes('punchLines'))) reasons.push('punch-line pattern');
    if (result.breakdown.some(b => b.includes('storyArc'))) reasons.push('story arc structure');
    return reasons.slice(0, 2).join(', ') || 'dramatic one-liner style';
  }

  function getCompressedBroetryReason(result) {
    if (!result.breakdown?.length) return 'short staccato sentences';
    const reasons = [];
    if (result.breakdown.some(b => b.includes('shortSentRatio'))) reasons.push('many short sentences');
    if (result.breakdown.some(b => b.includes('veryShortSentRatio'))) reasons.push('very short sentences');
    if (result.breakdown.some(b => b.includes('avgWPS'))) reasons.push('low words per sentence');
    if (result.breakdown.some(b => b.includes('dramaticFrag'))) reasons.push('dramatic fragments');
    if (result.breakdown.some(b => b.includes('manySentences'))) reasons.push('high sentence count');
    if (result.breakdown.some(b => b.includes('sentenceArc'))) reasons.push('story arc');
    return reasons.slice(0, 2).join(', ') || 'short staccato sentences';
  }

  function hidePost(postElement, authorName, reason) {
    if (postElement.dataset.broetryState === 'hidden') return;

    postElement.dataset.broetryState = 'hidden';
    postElement.classList.add('broetry-hidden');
    hiddenCount++;
    safeStorageSet({ hiddenCount, scannedCount });

    // Store author and reason on the element for re-hiding
    postElement.dataset.broetryAuthor = authorName || 'Unknown';
    postElement.dataset.broetryReason = reason || 'broetry detected';

    const placeholder = createPlaceholder(postElement, authorName, reason);
    postElement.parentNode.insertBefore(placeholder, postElement);
  }

  function createPlaceholder(postElement, authorName, reason) {
    const placeholder = document.createElement('div');
    placeholder.className = 'broetry-placeholder';

    const safeAuthor = (authorName || 'Unknown').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeReason = (reason || 'broetry detected').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    placeholder.innerHTML = `
      <div class="broetry-info">
        <span class="broetry-label"><strong>${safeAuthor}</strong></span>
        <span class="broetry-reason">${safeReason}</span>
      </div>
      <button class="broetry-show-btn">Show</button>
    `;

    placeholder.querySelector('.broetry-show-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      postElement.classList.remove('broetry-hidden');
      postElement.classList.add('broetry-revealed');
      postElement.dataset.broetryState = 'revealed';
      placeholder.remove();

      // Add a "Re-hide" bar at the top of the revealed post
      addRehideBar(postElement);
    });

    return placeholder;
  }

  function addRehideBar(postElement) {
    // Don't add twice
    if (postElement.querySelector('.broetry-rehide-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'broetry-rehide-bar';
    bar.innerHTML = `
      <span>🚫 Broetry — revealed</span>
      <button class="broetry-rehide-btn">Re-hide</button>
    `;

    bar.querySelector('.broetry-rehide-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const author = postElement.dataset.broetryAuthor || 'Unknown';
      const reason = postElement.dataset.broetryReason || 'broetry detected';

      postElement.classList.remove('broetry-revealed');
      postElement.classList.add('broetry-hidden');
      postElement.dataset.broetryState = 'hidden';
      bar.remove();

      const placeholder = createPlaceholder(postElement, author, reason);
      postElement.parentNode.insertBefore(placeholder, postElement);
    });

    postElement.prepend(bar);
  }

  function revealPost(postElement) {
    postElement.classList.remove('broetry-hidden', 'broetry-revealed');
    delete postElement.dataset.broetryState;
    // Remove re-hide bar if present
    const bar = postElement.querySelector('.broetry-rehide-bar');
    if (bar) bar.remove();
  }

  function revealAll() {
    document.querySelectorAll('[data-broetry-state]').forEach(post => revealPost(post));
    document.querySelectorAll('.broetry-placeholder').forEach(el => el.remove());
  }

  // ─── Scanning ───────────────────────────────────────────────────────

  let scanCount = 0;

  function scanPosts() {
    if (!filterEnabled || !contextValid) return;

    scanCount++;
    const { posts, debugInfo } = findFeedPosts();

    // Log every scan for the first 5 scans, then only when new posts found
    if (scanCount <= 5 || posts.length > 0) {
      log(`── Scan #${scanCount} ──`);
      log(`Strategy used: ${debugInfo.strategy}`);
      log(`Details:`, debugInfo.details);
    }

    if (posts.length === 0 && scanCount <= 3) {
      // Dump a DOM snapshot to help debug
      log('🔍 DOM snapshot for debugging:');

      const main = document.querySelector('main');
      log('  <main> found:', !!main);
      if (main) {
        log('  <main> children:', main.children.length);
        // Show first 3 children's tag + role + class prefix
        Array.from(main.children).slice(0, 3).forEach((child, i) => {
          log(`  main > child[${i}]:`, {
            tag: child.tagName,
            role: child.getAttribute('role'),
            componentkey: child.getAttribute('componentkey')?.substring(0, 30),
            classStart: child.className?.substring?.(0, 60),
            childCount: child.children.length,
          });
        });
      }

      // Check for common post indicators
      log('  Elements with role="listitem":', document.querySelectorAll('[role="listitem"]').length);
      log('  Elements with [componentkey]:', document.querySelectorAll('[componentkey]').length);
      log('  Elements with data-testid:', document.querySelectorAll('[data-testid]').length);
      log('  <h2> elements:', document.querySelectorAll('h2').length);

      // Show all unique data-testid values
      const testIds = new Set();
      document.querySelectorAll('[data-testid]').forEach(el => testIds.add(el.getAttribute('data-testid')));
      log('  All data-testid values:', Array.from(testIds));

      // Show all h2 texts
      const h2Texts = [];
      document.querySelectorAll('h2').forEach(h2 => {
        const t = h2.textContent.trim().substring(0, 60);
        if (t) h2Texts.push(t);
      });
      log('  All <h2> texts:', h2Texts);

      // Show all role values
      const roles = new Set();
      document.querySelectorAll('[role]').forEach(el => roles.add(el.getAttribute('role')));
      log('  All role values:', Array.from(roles));
    }

    let newPostCount = 0;

    posts.forEach(post => {
      if (processedPosts.has(post)) return;
      processedPosts.add(post);
      scannedCount++;
      newPostCount++;

      // Skip promoted/sponsored posts — check for "Promoted by" text in the post header
      const postText = post.textContent.toLowerCase();
      if (postText.includes('promoted by') || postText.includes('sponsored')) {
        log(`📝 Post #${scannedCount}: Skipped (promoted/sponsored post)`);
        return;
      }

      const { text, extractionMethod } = getPostText(post);
      const result = scoreBroetry(text);

      // Log every post's analysis
      const preview = text.trim().substring(0, 80).replace(/\n/g, '↵');
      log(`📝 Post #${scannedCount}:`);
      log(`   Text method: ${extractionMethod}`);
      log(`   Preview: "${preview}..."`);
      if (result.reason) {
        log(`   Skipped: ${result.reason}`);
      } else {
        log(`   Lines: ${result.totalLines}, Avg words/line: ${result.avgWordsPerLine}`);
        log(`   Score: ${result.score}/${result.threshold} (sensitivity=${sensitivity})`, result.isBroetry ? '🚫 BROETRY!' : '✅ OK');
        if (result.breakdown?.length) log(`   Breakdown:`, result.breakdown);
        if (result.lines?.length) log(`   First 5 lines:`, result.lines);
      }

      if (result.isBroetry) {
        const authorName = getPostAuthor(post);
        const reason = getBroetryReason(result);
        hidePost(post, authorName, reason);
      } else if (compressedBroetryEnabled) {
        // Check for compressed broetry (short sentences in paragraphs)
        const compResult = scoreCompressedBroetry(text);

        if (compResult.isCompressedBroetry) {
          log(`   📐 Compressed broetry check:`);
          log(`   Sentences: ${compResult.totalSentences}, Avg words/sentence: ${compResult.avgWordsPerSentence}`);
          log(`   Score: ${compResult.score}/${compResult.threshold}`, '🚫 COMPRESSED BROETRY!');
          if (compResult.breakdown?.length) log(`   Breakdown:`, compResult.breakdown);

          const authorName = getPostAuthor(post);
          const reason = 'compressed broetry: ' + getCompressedBroetryReason(compResult);
          hidePost(post, authorName, reason);
        }
      }
    });

    if (newPostCount > 0) {
      log(`Processed ${newPostCount} new posts. Total: ${scannedCount} scanned, ${hiddenCount} hidden.`);
    }

    safeStorageSet({ hiddenCount, scannedCount });
  }

  // ─── Auto-Load-More ─────────────────────────────────────────────────
  // Uses IntersectionObserver to detect when a "Load more" / "Show more"
  // button scrolls into view, then clicks it automatically.

  let autoLoadObserver = null;
  let autoLoadScanInterval = null;

  function findLoadMoreButton() {
    // Search ALL buttons on the page, not just inside <main>,
    // since LinkedIn may place it outside <main>
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      // Exact or near-exact matches
      if (
        text === 'load more' ||
        text === 'show more' ||
        text === 'show more results' ||
        text === 'load more results' ||
        text === 'show more posts'
      ) {
        return btn;
      }
    }

    // Broader fallback: any button whose text starts with or matches load/show more
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.match(/^(load|show)\s+more/)) {
        return btn;
      }
    }

    return null;
  }

  function startAutoLoad() {
    stopAutoLoad();
    log('Auto-load-more: ENABLED');

    // Periodically look for the button and observe it
    autoLoadScanInterval = setInterval(() => {
      if (!autoLoadMore || !contextValid) { stopAutoLoad(); return; }

      const btn = findLoadMoreButton();
      if (!btn || btn.dataset.broetryAutoLoadWatched) return;

      btn.dataset.broetryAutoLoadWatched = 'true';
      log('Auto-load-more: Found "Load more" button, watching for visibility');

      autoLoadObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && autoLoadMore && contextValid) {
            log('Auto-load-more: Button in view — clicking');
            entry.target.click();
            // Stop observing this button (a new one may appear)
            autoLoadObserver.unobserve(entry.target);
            delete entry.target.dataset.broetryAutoLoadWatched;
          }
        }
      }, { threshold: 0.5 });

      autoLoadObserver.observe(btn);
    }, 2000);
  }

  function stopAutoLoad() {
    if (autoLoadObserver) { autoLoadObserver.disconnect(); autoLoadObserver = null; }
    if (autoLoadScanInterval) { clearInterval(autoLoadScanInterval); autoLoadScanInterval = null; }
    // Clean up watched flags
    document.querySelectorAll('[data-broetry-auto-load-watched]').forEach(el => {
      delete el.dataset.broetryAutoLoadWatched;
    });
    log('Auto-load-more: DISABLED');
  }

  // ─── Lifecycle & Cleanup ────────────────────────────────────────────

  let observer = null;
  let scanInterval = null;

  function cleanup() {
    contextValid = false;
    if (observer) { observer.disconnect(); observer = null; }
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    stopAutoLoad();
  }

  // ─── Initialization ─────────────────────────────────────────────────

  safeStorageGet(['filterEnabled', 'sensitivity', 'autoLoadMore', 'compressedBroetry'], (data) => {
    if (!data) return;
    filterEnabled = data.filterEnabled !== false;
    sensitivity = data.sensitivity || 2;
    autoLoadMore = data.autoLoadMore === true;
    compressedBroetryEnabled = data.compressedBroetry === true;
    // Always start fresh counts on page load
    hiddenCount = 0;
    scannedCount = 0;
    safeStorageSet({ hiddenCount: 0, scannedCount: 0 });
    log(`Loaded settings: enabled=${filterEnabled}, sensitivity=${sensitivity}, autoLoad=${autoLoadMore}, compressed=${compressedBroetryEnabled}`);
    if (autoLoadMore) startAutoLoad();
  });

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!contextValid) return;
      if (msg.type === 'TOGGLE_FILTER') {
        filterEnabled = msg.enabled;
        log(`Filter toggled: ${filterEnabled}`);
        if (filterEnabled) {
          // Reset everything so all visible posts get re-evaluated cleanly
          processedPosts = new WeakSet();
          hiddenCount = 0;
          scannedCount = 0;
          scanPosts();
        } else {
          revealAll();
        }
      } else if (msg.type === 'SET_SENSITIVITY') {
        sensitivity = msg.sensitivity;
        log(`Sensitivity changed: ${sensitivity}`);
        revealAll();
        processedPosts = new WeakSet();
        hiddenCount = 0;
        scannedCount = 0;
        scanPosts();
      } else if (msg.type === 'TOGGLE_AUTO_LOAD') {
        autoLoadMore = msg.enabled;
        log(`Auto-load-more toggled: ${autoLoadMore}`);
        if (autoLoadMore) startAutoLoad();
        else stopAutoLoad();
      } else if (msg.type === 'TOGGLE_COMPRESSED_BROETRY') {
        compressedBroetryEnabled = msg.enabled;
        log(`Compressed broetry toggled: ${compressedBroetryEnabled}`);
        revealAll();
        processedPosts = new WeakSet();
        hiddenCount = 0;
        scannedCount = 0;
        scanPosts();
      }
    });
  } catch (e) {
    contextValid = false;
  }

  // Initial scan after delay
  setTimeout(scanPosts, 2000);

  // MutationObserver
  function startObserving() {
    const feedContainer = document.querySelector('main') || document.body;
    let debounceTimer = null;

    observer = new MutationObserver((mutations) => {
      if (!contextValid) { cleanup(); return; }

      let hasNewContent = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.getAttribute?.('role') === 'listitem' ||
                node.querySelector?.('[role="listitem"]') ||
                node.querySelector?.('[data-testid="expandable-text-box"]') ||
                node.getAttribute?.('componentkey')) {
              hasNewContent = true;
              break;
            }
          }
        }
        if (hasNewContent) break;
      }

      if (hasNewContent) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(scanPosts, 300);
      }
    });

    observer.observe(feedContainer, { childList: true, subtree: true });
    log('MutationObserver attached to', feedContainer.tagName);
  }

  if (document.querySelector('main')) {
    startObserving();
  } else {
    const waitForMain = new MutationObserver(() => {
      if (document.querySelector('main')) {
        waitForMain.disconnect();
        startObserving();
      }
    });
    waitForMain.observe(document.body, { childList: true, subtree: true });
  }

  // Periodic fallback
  scanInterval = setInterval(() => {
    if (!contextValid) { cleanup(); return; }
    scanPosts();
  }, 5000);

  log('🚫 Broetry Filter loaded. Waiting for feed to render...');
})();
