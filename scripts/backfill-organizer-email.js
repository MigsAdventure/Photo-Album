#!/usr/bin/env node
/**
 * Normalise `organizerEmail` on events created before the casing fix.
 *
 * Why this exists
 * ---------------
 * The organizer dashboard finds your events with
 *
 *     where('organizerEmail', '==', signedInEmail.toLowerCase())
 *
 * and Firestore's `==` is byte-exact. A Firestore filter cannot transform the
 * stored value, so the only place the comparison can be made to work is at
 * write time — which is what `createEvent` in src/services/photoService.ts now
 * does, trimming and lowercasing before it stores.
 *
 * That fixes every event created from then on and nothing created before it. An
 * organizer who typed "Sarah.Jones@Gmail.com" when they made their event still
 * has it stored that way, still signs in as sarah.jones@gmail.com, and still
 * sees the empty "No events yet" state — with no error, because nothing failed.
 * The query was answered correctly; it just matched nothing.
 *
 * The security rules are not affected either way: `isOrganizerOf` lowercases
 * both sides, so access was never wrongly granted or denied. This is only about
 * the list query finding the documents.
 *
 * Run this once, before telling any existing customer the dashboard exists.
 *
 * Usage
 * -----
 *   FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" \
 *     node scripts/backfill-organizer-email.js            # dry run, changes nothing
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" \
 *     node scripts/backfill-organizer-email.js --apply    # writes
 *
 * It is idempotent: a second run finds nothing to do. Safe to re-run if it is
 * interrupted.
 *
 * Refs: docs/HANDOFF.md, src/services/photoService.ts
 */

const { getDb } = require('../netlify/functions/_lib/firebase-admin');

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 400;

const APPLY = process.argv.includes('--apply');

/**
 * The single definition of "normalised".
 *
 * This must stay identical to createEvent in src/services/photoService.ts. If
 * the two ever disagree, this script quietly re-breaks the documents it was
 * written to repair.
 */
function normalise(email) {
  return String(email).trim().toLowerCase();
}

async function main() {
  const db = getDb();

  console.log(APPLY ? 'Backfilling organizerEmail…\n' : 'Dry run — nothing will be written.\n');

  const snapshot = await db.collection('events').get();

  const changes = [];
  let missing = 0;

  snapshot.forEach((doc) => {
    const current = doc.data().organizerEmail;

    // An event with no organizerEmail at all is a different problem: there is no
    // address to normalise and no way to guess one. Report and skip rather than
    // writing an empty string, which would look repaired without being so.
    if (typeof current !== 'string' || current.trim() === '') {
      missing++;
      console.warn(`  no organizerEmail   ${doc.id}`);
      return;
    }

    const normalised = normalise(current);
    if (normalised !== current) {
      changes.push({ id: doc.id, from: current, to: normalised });
    }
  });

  console.log(`\nScanned ${snapshot.size} event(s).`);
  console.log(`  ${changes.length} need normalising`);
  console.log(`  ${missing} have no organizerEmail (skipped, needs a human)`);

  if (changes.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  console.log('');
  for (const change of changes) {
    console.log(`  ${change.id}\n    ${change.from}  ->  ${change.to}`);
  }

  if (!APPLY) {
    console.log('\nRe-run with --apply to write these changes.');
    return;
  }

  let written = 0;
  for (let i = 0; i < changes.length; i += BATCH_LIMIT) {
    const slice = changes.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();

    for (const change of slice) {
      batch.update(db.collection('events').doc(change.id), { organizerEmail: change.to });
    }

    await batch.commit();
    written += slice.length;
    console.log(`\nCommitted ${written}/${changes.length}`);
  }

  console.log('\nDone. Re-run without --apply to confirm it now reports nothing to do.');
}

// Only run when executed directly, so the tests can import `normalise` and
// check it still agrees with the client — without connecting to Firestore.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\nBackfill failed:', error.message);
      // Non-zero so this is not mistaken for success in a deploy log. Partial
      // batches that already committed stay committed; the script is idempotent,
      // so the fix is to run it again.
      process.exit(1);
    });
}

module.exports = { normalise };
