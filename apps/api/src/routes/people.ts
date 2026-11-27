// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PEOPLE BEING MOVED (ADR-0050, amended by the owner on 2026-09-28;
 * workplan 0153 T2).
 *
 *  - `GET /api/people` lists everyone the organisation is moving, each with
 *    their migrations' states and counts, and the migrations that are nobody's
 *    yet.
 *  - `POST /api/people` creates one: a name, and optionally an address for
 *    grant links (0108).
 *  - `POST /api/people/:personId/migrations` adds a migration to one. Adding
 *    it again changes nothing, and a migration that is somebody else's stays
 *    theirs.
 *  - `DELETE /api/people/:personId` deletes one, and no migration: theirs
 *    belong to nobody again.
 *  - `PUT /api/people/:personId/myself` says the person is the member who
 *    asks ("This is me"), and `DELETE` there says they are not (ADR-0050,
 *    amended 2026-11-19). `POST /api/people` takes `myself: true` for the same
 *    when the person is new.
 *
 * THE MEMBER IS THE SIGN-IN, NEVER THE BODY. A person is linked to the
 * subject `authenticate` verified (`req.userId`), and no route here reads an
 * account id from a request, so a member links their own account and nobody
 * else's. What goes back is `you` on each person, worked out against that
 * subject; no account id is in any answer.
 *
 * THE SAME TENANT CHECKS AS THE MIGRATION ROUTES: `authenticate`, the tenant
 * from the session, and every read and write inside the organisation's own
 * transaction, under the policies of managed migration 0031. Any member may
 * do each, as with a migration itself.
 *
 * THE SHAPES ARE `@openmig/shared`'s (`people.ts`), and the appliance answers
 * `GET /people` in them too, with one implicit person (ADR-0026). A person
 * changes nothing about a migration, and nothing here writes one.
 *
 * NOT REFUSED FOR A CLOSED ORGANISATION. A person is a name: creating one
 * starts no pass, re-arms nothing and uses no stored access, which is what a
 * close stops (`closed-organisation.ts`). The erasure removes people with the
 * rest (`PURGED_TABLES`).
 */

import { Router } from 'express';
import { idsThatAreNoUuid } from '../an-id-that-is-no-uuid.ts';
import type { Response } from 'express';
import { z } from 'zod';
import {
  addMigrationToPerson,
  migrationReceivingRefusal,
  createMyself,
  createPerson,
  deletePerson,
  listPeople,
  markMyself,
  unmarkMyself,
} from '@openmig/managed';
import {
  ANOTHER_MEMBERS,
  MIGRATION_NOT_FOUND,
  NOT_A_MEMBER,
  PERSON_EMAIL_MAX,
  PERSON_NAME_MAX,
  PERSON_NOT_FOUND,
  WITH_ANOTHER_PERSON,
} from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import personLinkRoutes from './person-link-routes.ts';

const router = idsThatAreNoUuid(Router(), {
  checkedByItsRoutes: {
    personId: 'personIdOf after sign-in, 404 person_not_found (people.unit.test.ts, this-is-me.unit.test.ts)',
  },
});

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

/**
 * An id's shape, checked before it reaches a uuid column: a value that is not
 * one cannot name a person, and Postgres would answer it with a cast error.
 */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The check the other routes make of an address (`access-requests.ts`, `problem-report.ts`). */
const EMAIL = z.string().email();

const CreatePersonSchema = z.object({
  displayName: z
    .string({ error: 'A person needs a name.' })
    .trim()
    .min(1, 'A person needs a name.')
    .max(PERSON_NAME_MAX, `A name is at most ${PERSON_NAME_MAX} characters.`),
  // Optional, and an empty box, or one of spaces, is no address rather than a wrong one.
  email: z
    .string()
    .trim()
    .max(PERSON_EMAIL_MAX, `An email address is at most ${PERSON_EMAIL_MAX} characters.`)
    .refine((v) => v === '' || EMAIL.safeParse(v).success, 'That is not an email address.')
    .nullish()
    .transform((v) => (v ? v : null)),
  // The person is the member asking. Who that is comes from the sign-in: a
  // key naming an account is not read, so it cannot name somebody else's.
  myself: z.boolean({ error: 'myself is true or false.' }).optional(),
});

const AddMigrationSchema = z.object({
  mappingId: z.string().regex(ID, 'mappingId is not a migration id.'),
});

/** The tenant, or the 401 the migration routes answer without one. */
function tenantOf(req: AuthenticatedRequest, res: Response): string | undefined {
  if (req.tenantId) return req.tenantId;
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Tenant ID not found in authentication context',
  });
  return undefined;
}

/** The route's `:personId` when it can name a person, else the 404 for one that does not. */
function personIdOf(req: AuthenticatedRequest, res: Response): string | undefined {
  const personId = req.params.personId;
  if (typeof personId === 'string' && ID.test(personId)) return personId;
  personNotFound(res);
  return undefined;
}

function personNotFound(res: Response): void {
  res.status(404).json({ error: PERSON_NOT_FOUND, message: 'There is no such person in this organisation.' });
}

/**
 * The asker is no active member here. `authenticate` admits members only, so
 * this is a sign-in that lost its membership between the check and the write,
 * or the development mode, which checks none.
 */
function notAMember(res: Response): void {
  res.status(403).json({
    error: NOT_A_MEMBER,
    message: 'Only a member of this organisation can say that a person here is them.',
  });
}

/** A validation refusal, in the shape the migration routes answer with. */
function invalid(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: 'Validation error',
    message: error.issues.map((i) => i.message).join(' '),
    details: error.issues,
  });
}

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const people = await withTenantDb(tenantId, getSharedPool(), (db) => listPeople(db, tenantId, req.userId));
    res.json(people);
  } catch (error) {
    // Never an empty list on failure: "we could not read them" and "there is
    // nobody" are opposite sentences (hard rule 9).
    serverFault(res, 'people_list_failed', 'listing the people you are moving', error);
  }
});

router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const parsed = CreatePersonSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);
    const input = { displayName: parsed.data.displayName, email: parsed.data.email };
    if (parsed.data.myself === true) {
      const outcome = await withTenantDb(tenantId, getSharedPool(), (db) =>
        createMyself(db, tenantId, input, req.userId),
      );
      if (outcome.kind === 'not_a_member') return notAMember(res);
      res.status(201).json(outcome.person);
      return;
    }
    const created = await withTenantDb(tenantId, getSharedPool(), (db) => createPerson(db, tenantId, input));
    res.status(201).json(created);
  } catch (error) {
    serverFault(res, 'person_create_failed', 'adding this person', error);
  }
});

router.post('/:personId/migrations', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const personId = personIdOf(req, res);
    if (!personId) return;
    const parsed = AddMigrationSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, parsed.error);

    const outcome = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      // A destination a person connected themselves through their grant link
      // takes only their migrations (workplan 0174 §4.3, D1 (a)).
      const notTheirs = await migrationReceivingRefusal(db, tenantId, parsed.data.mappingId, personId);
      if (notTheirs) return { kind: 'granted_by_another_person' as const, said: notTheirs };
      return addMigrationToPerson(db, tenantId, personId, parsed.data.mappingId, req.userId);
    });
    if (outcome.kind === 'granted_by_another_person') {
      res.status(409).json({ error: 'granted_by_another_person', message: outcome.said.en, messageNl: outcome.said.nl });
      return;
    }
    switch (outcome.kind) {
      case 'added':
        res.status(201).json(outcome.person);
        return;
      case 'already_theirs':
        res.status(200).json(outcome.person);
        return;
      case 'no_such_person':
        personNotFound(res);
        return;
      case 'no_such_migration':
        res.status(404).json({
          error: MIGRATION_NOT_FOUND,
          message: 'There is no such migration in this organisation.',
        });
        return;
      case 'with_another_person':
        res.status(409).json({
          error: WITH_ANOTHER_PERSON,
          message: 'This migration is already somebody else’s. A migration belongs to one person at most.',
          personId: outcome.personId,
        });
        return;
    }
  } catch (error) {
    serverFault(res, 'person_add_failed', 'adding this migration to the person', error);
  }
});

router.delete('/:personId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const personId = personIdOf(req, res);
    if (!personId) return;
    const gone = await withTenantDb(tenantId, getSharedPool(), (db) => deletePerson(db, tenantId, personId));
    if (!gone) return personNotFound(res);
    res.json(gone);
  } catch (error) {
    serverFault(res, 'person_delete_failed', 'deleting this person', error);
  }
});

// "This is me" (ADR-0050, amended 2026-11-19): the person becomes the asking
// member's own, and any other person of theirs here stops being so. Any
// member may say it of themselves, as any member may add a person.
router.put('/:personId/myself', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const personId = personIdOf(req, res);
    if (!personId) return;
    const outcome = await withTenantDb(tenantId, getSharedPool(), (db) =>
      markMyself(db, tenantId, personId, req.userId),
    );
    switch (outcome.kind) {
      case 'marked':
      case 'already_yours':
        res.status(200).json(outcome.person);
        return;
      case 'no_such_person':
        personNotFound(res);
        return;
      case 'not_a_member':
        notAMember(res);
        return;
      case 'another_members':
        res.status(409).json({
          error: ANOTHER_MEMBERS,
          message: 'This person is already another member’s own. Only they can say it is not them.',
        });
        return;
    }
  } catch (error) {
    serverFault(res, 'person_myself_failed', 'saying this person is you', error);
  }
});

// "This is not me": only the asking member's own link is undone. A person
// who is nobody's, or another member's, is answered as it is.
router.delete('/:personId/myself', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;
    const personId = personIdOf(req, res);
    if (!personId) return;
    const outcome = await withTenantDb(tenantId, getSharedPool(), (db) =>
      unmarkMyself(db, tenantId, personId, req.userId),
    );
    if (outcome.kind === 'no_such_person') return personNotFound(res);
    res.status(200).json(outcome.person);
  } catch (error) {
    serverFault(res, 'person_not_myself_failed', 'saying this person is not you', error);
  }
});

// A person's links (ADR-0035, amended 2026-09-29; 0153 T5 (b)): owner or admin,
// under `/:personId/links`.
router.use('/', personLinkRoutes);

export default router;
