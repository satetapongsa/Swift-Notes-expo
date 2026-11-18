// Three-way text merge used by both the API and the app.
// Applies the changes that turned `base` into `mine` on top of `theirs`,
// so two people editing the same note keep each other's work.
const DiffMatchPatch = require('diff-match-patch');

const dmp = new DiffMatchPatch();
dmp.Match_Threshold = 0.4;
dmp.Patch_DeleteThreshold = 0.4;

function merge3(base, mine, theirs) {
  base = base ?? '';
  mine = mine ?? '';
  theirs = theirs ?? '';
  if (mine === base) return theirs;
  if (theirs === base || theirs === mine) return mine;
  const patches = dmp.patch_make(base, mine);
  const [result, applied] = dmp.patch_apply(patches, theirs);

  // A patch that found no place to land (e.g. both sides started from an empty note)
  // must not lose text: append whatever it was inserting.
  const lost = patches
    .filter((_, i) => !applied[i])
    .flatMap(p => p.diffs.filter(([op]) => op === DiffMatchPatch.DIFF_INSERT).map(([, text]) => text))
    .join('');
  if (!lost) return result;
  const sep = result && !result.endsWith('\n') ? '\n' : '';
  return result + sep + lost;
}

module.exports = { merge3 };
