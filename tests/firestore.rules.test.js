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
    url: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media',
    uploadedAt: Timestamp.now(),
    eventId: EVENT_ID,
    fileName: 'IMG_0001.jpg',
    size: 3_500_000,
    contentType: 'image/jpeg',
    storagePath: `events/${EVENT_ID}/photos/photo-uuid.jpg`,
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

describe('events — photo counting', () => {
  beforeEach(async () => {
    await seed((db) =>
      setDoc(doc(db, 'events', EVENT_ID), validEvent({ photoCount: 10 }))
    );
  });

  test('incrementing by one is allowed', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'events', EVENT_ID), { photoCount: increment(1) })
    );
  });

  test('decrementing by one is allowed', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'events', EVENT_ID), { photoCount: increment(-1) })
    );
  });

  test('jumping the count by a large delta is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { photoCount: increment(1000) })
    );
  });

  test('resetting the count to zero to dodge the plan limit is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { photoCount: 0 }));
  });

  test('driving the count negative is rejected', async () => {
    await seed((db) =>
      setDoc(doc(db, 'events', EVENT_ID), validEvent({ photoCount: 0 }))
    );
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, 'events', EVENT_ID), { photoCount: increment(-1) })
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

  test('a guest can upload a photo to an existing event', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(addDoc(collection(db, 'photos'), validPhoto()));
  });

  test('a guest can upload a video', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      addDoc(
        collection(db, 'photos'),
        validPhoto({
          mediaType: 'video',
          fileName: 'IMG_0002.mov',
          contentType: 'video/quicktime',
          size: 480_000_000,
        })
      )
    );
  });

  test('the gallery can read photos for an event', async () => {
    await seed((db) => addDoc(collection(db, 'photos'), validPhoto()));
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'photos'), where('eventId', '==', EVENT_ID)))
    );
  });

  test('a photo attached to a non-existent event is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      addDoc(collection(db, 'photos'), validPhoto({ eventId: 'no-such-event' }))
    );
  });

  test('a photo claiming an r2Key at creation is rejected', async () => {
    // A client-supplied r2Key would point the gallery at an arbitrary object in
    // the bucket. The server stamps it after the copy completes.
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      addDoc(collection(db, 'photos'), validPhoto({ r2Key: 'media/other-event/secret.jpg' }))
    );
  });

  test('a photo above the 2 GB ceiling is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      addDoc(collection(db, 'photos'), validPhoto({ size: 3_000_000_000 }))
    );
  });

  test('a photo with a zero size is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(addDoc(collection(db, 'photos'), validPhoto({ size: 0 })));
  });

  test('a photo with an unrecognised media type is rejected', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      addDoc(collection(db, 'photos'), validPhoto({ mediaType: 'executable' }))
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
