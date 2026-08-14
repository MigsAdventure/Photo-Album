/**
 * Firestore security rules tests (finding SEC-2).
 *
 * These run against the Firestore emulator, so they exercise the real rules
 * engine rather than a model of it. Run with:
 *
 *   npm run test:rules
 *
 * Each test names the attack or the legitimate flow it covers. When a rule
 * changes, the test that fails should tell you which behaviour you altered.
 */

const { readFileSync } = require('fs');
const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  increment,
  Timestamp,
} = require('firebase/firestore');

let testEnv;

const EVENT_ID = '2026-06-14_smith-wedding_a1b2c3d4';

/** A well-formed free event, as createEvent() in photoService.ts writes it. */
function validEvent(overrides = {}) {
  return {
    title: 'Smith Wedding',
    date: '2026-06-14',
    createdAt: Timestamp.now(),
    isActive: true,
    organizerEmail: 'organizer@example.com',
    planType: 'free',
    photoLimit: 2,
    photoCount: 0,
    ...overrides,
  };
}

/** A well-formed photo, as uploadPhoto() in photoService.ts writes it. */
function validPhoto(overrides = {}) {
  return {
    id: 'photo-uuid',
    url: 'https://photos.example.com/media/evt/abc.jpg',
    uploadedAt: Timestamp.now(),
    eventId: EVENT_ID,
    fileName: 'IMG_0001.jpg',
    size: 3_500_000,
    contentType: 'image/jpeg',
    storage: 'r2',
    mediaType: 'photo',
    uploadedBy: 'sess_1234567890_abcdefghi',
    ...overrides,
  };
}

/** Seed data written with rules disabled, standing in for existing state. */
async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore());
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'sharedmoments-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('events — reading', () => {
  test('anyone can read a single event (public galleries)', async () => {
    await seed((db) => setDoc(doc(db, 'events', EVENT_ID), validEvent()));
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'events', EVENT_ID)));
  });

  test('nobody can enumerate every event in the project', async () => {
    await seed((db) => setDoc(doc(db, 'events', EVENT_ID), validEvent()));
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, 'events')));
  });
});

describe('events — creation', () => {
  test('a guest can create a normal free event', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(db, 'events', EVENT_ID), validEvent()));
  });

  test('creating an event that is already premium is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'events', EVENT_ID), validEvent({ planType: 'premium' }))
    );
  });

  test('creating an event with unlimited photos is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(
        doc(db, 'events', EVENT_ID),
        validEvent({ planType: 'premium', photoLimit: -1 })
      )
    );
  });

  test('creating an event with a non-zero photo count is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'events', EVENT_ID), validEvent({ photoCount: 500 }))
    );
  });

  test('creating an event with no title is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'events', EVENT_ID), validEvent({ title: '' })));
  });
});

describe('events — the premium escalation path (SEC-2)', () => {
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'events', EVENT_ID), validEvent()));
  });

  test('a client cannot upgrade an event to premium', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), {
        planType: 'premium',
        photoLimit: -1,
      })
    );
  });

  test('a client cannot raise the photo limit on its own', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { photoLimit: 9999 }));
  });

  test('a client cannot forge a payment id', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { paymentId: 'faked' }));
  });

  test('a client cannot redirect the organizer email to itself', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { organizerEmail: 'attacker@evil.test' })
    );
  });

  test('smuggling planType alongside a legitimate photoCount bump is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), {
        photoCount: increment(1),
        planType: 'premium',
      })
    );
  });

  test('the Admin SDK can still upgrade an event', async () => {
    // withSecurityRulesDisabled stands in for the Admin SDK, which bypasses rules.
    await assertSucceeds(
      seed((db) =>
        updateDoc(doc(db, 'events', EVENT_ID), {
          planType: 'premium',
          photoLimit: -1,
          paymentId: 'ghl_order_123',
        })
      )
    );
  });
});

describe('events — photo counting (now server-only)', () => {
  beforeEach(async () => {
    await seed((db) =>
      setDoc(doc(db, 'events', EVENT_ID), validEvent({ photoCount: 10 }))
    );
  });

  // Clients used to be allowed to move photoCount by one, because the browser
  // incremented it after each upload. Uploads are server-side now
  // (upload-complete.js increments, delete-photo.js decrements), so there is no
  // legitimate client write left and the rule denies all of them.
  test('a client cannot increment the count', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { photoCount: increment(1) })
    );
  });

  test('a client cannot decrement the count', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { photoCount: increment(-1) })
    );
  });

  test('a client cannot reset the count to dodge the plan limit', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { photoCount: 0 }));
  });

  test('the server can still adjust the count', async () => {
    await assertSucceeds(
      seed((db) =>
        updateDoc(doc(db, 'events', EVENT_ID), { photoCount: increment(1) })
      )
    );
  });
});

describe('events — deletion', () => {
  test('a client cannot delete an event', async () => {
    await seed((db) => setDoc(doc(db, 'events', EVENT_ID), validEvent()));
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(db, 'events', EVENT_ID)));
  });
});

describe('photos', () => {
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'events', EVENT_ID), validEvent()));
  });

  test('the gallery can read photos for an event', async () => {
    await seed((db) => addDoc(collection(db, 'photos'), validPhoto()));
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'photos'), where('eventId', '==', EVENT_ID)))
    );
  });

  test('anyone can read a single photo', async () => {
    let photoId;
    await seed(async (db) => {
      const ref = await addDoc(collection(db, 'photos'), validPhoto());
      photoId = ref.id;
    });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'photos', photoId)));
  });

  // Photo documents are written only by upload-complete.js, after it has
  // confirmed the object exists in R2 at the size we authorised. A client
  // cannot create one at all, so a document can never exist without its bytes.
  test('a client cannot create a photo document', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(addDoc(collection(db, 'photos'), validPhoto()));
  });

  test('a client cannot create one pointing at another event’s object', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      addDoc(
        collection(db, 'photos'),
        validPhoto({ r2Key: 'media/some-other-event/private.jpg' })
      )
    );
  });

  test('the server can create a photo document', async () => {
    await assertSucceeds(
      seed((db) =>
        addDoc(collection(db, 'photos'), validPhoto({ r2Key: 'media/e/abc.jpg' }))
      )
    );
  });

  test('a client cannot modify an existing photo', async () => {
    let photoId;
    await seed(async (db) => {
      const ref = await addDoc(collection(db, 'photos'), validPhoto());
      photoId = ref.id;
    });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'photos', photoId), { url: 'https://evil.test/swap.jpg' })
    );
  });

  test('a client cannot delete someone else’s photo (SEC-5)', async () => {
    let photoId;
    await seed(async (db) => {
      const ref = await addDoc(
        collection(db, 'photos'),
        validPhoto({ uploadedBy: 'sess_someone_else' })
      );
      photoId = ref.id;
    });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(db, 'photos', photoId)));
  });

  test('a client cannot delete its own photo either — deletes go through the server', async () => {
    let photoId;
    await seed(async (db) => {
      const ref = await addDoc(collection(db, 'photos'), validPhoto());
      photoId = ref.id;
    });
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(db, 'photos', photoId)));
  });
});

describe('organizer access (UX-2)', () => {
  const ORGANIZER = 'organizer@example.com';
  const STRANGER = 'someone-else@example.com';

  /** A signed-in organizer, as Firebase email-link sign-in presents them. */
  function asUser(email, emailVerified = true) {
    return testEnv
      .authenticatedContext(`uid_${email}`, { email, email_verified: emailVerified })
      .firestore();
  }

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'events', EVENT_ID), validEvent());
      await setDoc(doc(db, 'events', 'other-event'), validEvent({ organizerEmail: STRANGER }));
    });
  });

  test('an organizer can list their own events', async () => {
    const db = asUser(ORGANIZER);
    await assertSucceeds(
      getDocs(query(collection(db, 'events'), where('organizerEmail', '==', ORGANIZER)))
    );
  });

  test('an organizer cannot list somebody else’s events', async () => {
    const db = asUser(ORGANIZER);
    await assertFails(
      getDocs(query(collection(db, 'events'), where('organizerEmail', '==', STRANGER)))
    );
  });

  test('a signed-in user still cannot enumerate every event', async () => {
    // The whole point of scoping list rather than just allowing it.
    const db = asUser(ORGANIZER);
    await assertFails(getDocs(collection(db, 'events')));
  });

  test('an anonymous visitor cannot list events at all', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      getDocs(query(collection(db, 'events'), where('organizerEmail', '==', ORGANIZER)))
    );
  });

  test('an unverified email is not an identity', async () => {
    const db = asUser(ORGANIZER, false);
    await assertFails(
      getDocs(query(collection(db, 'events'), where('organizerEmail', '==', ORGANIZER)))
    );
  });

  test('address casing does not lock an organizer out of their own event', async () => {
    // Firebase preserves the case the user typed; our events store whatever was
    // entered at creation. Comparing exactly would strand people.
    const db = asUser('Organizer@Example.com');
    await assertSucceeds(
      updateDoc(doc(db, 'events', EVENT_ID), { title: 'Renamed by organizer' })
    );
  });

  test('an organizer can edit their own event’s presentation', async () => {
    const db = asUser(ORGANIZER);
    await assertSucceeds(
      updateDoc(doc(db, 'events', EVENT_ID), {
        title: 'Smith Wedding — Reception',
        date: '2026-06-15',
        isActive: false,
      })
    );
  });

  test('an organizer cannot grant themselves premium', async () => {
    // The whole reason the editable set is an allowlist rather than a denylist.
    const db = asUser(ORGANIZER);
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { planType: 'premium', photoLimit: -1 })
    );
  });

  test('an organizer cannot smuggle planType alongside a legitimate edit', async () => {
    const db = asUser(ORGANIZER);
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { title: 'New title', planType: 'premium' })
    );
  });

  test('an organizer cannot inflate their own photo count', async () => {
    // Must be a *different* value. Writing the current value back changes no
    // keys, so diff().affectedKeys() is empty and hasOnly() trivially passes —
    // a harmless no-op, but it means the first version of this test passed
    // without exercising the rule at all.
    await seed((db) =>
      setDoc(doc(db, 'events', EVENT_ID), validEvent({ photoCount: 7 }))
    );

    const db = asUser(ORGANIZER);
    await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { photoCount: 9999 }));
  });

  test('an organizer cannot reset their photo count to dodge the ceiling', async () => {
    await seed((db) =>
      setDoc(doc(db, 'events', EVENT_ID), validEvent({ photoCount: 4999 }))
    );

    const db = asUser(ORGANIZER);
    await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { photoCount: 0 }));
  });

  test('an organizer cannot edit somebody else’s event', async () => {
    const db = asUser(ORGANIZER);
    await assertFails(updateDoc(doc(db, 'events', 'other-event'), { title: 'Hijacked' }));
  });

  test('an organizer cannot hand their event to another address', async () => {
    // organizerEmail is outside the editable set, so ownership cannot be moved
    // from a browser.
    const db = asUser(ORGANIZER);
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { organizerEmail: STRANGER })
    );
  });

  test('an organizer still cannot delete an event', async () => {
    const db = asUser(ORGANIZER);
    await assertFails(deleteDoc(doc(db, 'events', EVENT_ID)));
  });

  test('an organizer still cannot delete a photo directly', async () => {
    // Moderation goes through delete-photo.js with an ID token, so that
    // Firestore, Storage and R2 stay consistent.
    let photoId;
    await seed(async (db) => {
      const ref = await addDoc(collection(db, 'photos'), validPhoto());
      photoId = ref.id;
    });
    const db = asUser(ORGANIZER);
    await assertFails(deleteDoc(doc(db, 'photos', photoId)));
  });
});

describe('downloadJobs — server-only (SEC-4)', () => {
  test('a client cannot read the rate-limit counters it is subject to', async () => {
    await seed((db) =>
      setDoc(doc(db, 'downloadJobs', 'job-1'), { eventId: EVENT_ID, count: 3 })
    );
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'downloadJobs', 'job-1')));
  });

  test('a client cannot clear a rate-limit counter', async () => {
    await seed((db) =>
      setDoc(doc(db, 'downloadJobs', 'job-1'), { eventId: EVENT_ID, count: 3 })
    );
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'downloadJobs', 'job-1'), { count: 0 }));
  });
});

describe('unknown collections', () => {
  test('a collection with no rule is denied by default', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'somethingNew', 'x'), { a: 1 }));
  });
});
