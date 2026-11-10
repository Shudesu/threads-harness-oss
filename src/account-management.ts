import { Hono, type Context } from 'hono';
import { ThreadsError, seal, validateEncryptionKey } from './threads';

/**
 * account-mgmt/v1 for Threads accounts. `threads_accounts.id` IS the Threads
 * user id, so the immutable subject equals the account id. Secrets arrive only
 * in `input`; they are never echoed, logged, stored in receipts or fingerprints.
 */
export const CONTRACT = 'account-mgmt/v1';
export type VerifiedIdentity = { id: string; username: string; tokenExpiresAt: string | null; dataAccessExpiresAt: string | null };
type Env = { DB: D1Database; TOKEN_ENCRYPTION_KEY: string };
export type IdentityVerifier = (token: string, env: any) => Promise<VerifiedIdentity>;

const ACTIONS = ['create', 'reconnect', 'update_settings', 'deactivate', 'activate', 'disconnect'] as const;
type Action = typeof ACTIONS[number];
const KNOWN_UNSUPPORTED = new Set(['set_default', 'resume', 'delete']);
const INPUT_KEYS: Record<Action, { required: string[]; optional: string[] }> = {
  create: { required: ['accessToken'], optional: ['name'] },
  reconnect: { required: ['accessToken'], optional: [] },
  // `displayName` is an alias of `name`; both map to the single display_name column.
  update_settings: { required: [], optional: ['name', 'displayName'] },
  deactivate: { required: [], optional: [] },
  activate: { required: [], optional: [] },
  disconnect: { required: [], optional: [] },
};
const BODY_KEYS = ['operationId', 'action', 'accountId', 'expectedRevision', 'expectedSubject', 'input'];
const OPERATION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const REVISION = /^[1-9]\d{0,15}$/;
const SUBJECT = /^\d{1,64}$/;

class MgmtError extends Error {
  constructor(public code: string, public status: 400 | 404 | 409 | 422 | 500 | 502 | 503) { super(code); }
}
const failure = (c: Context, code: string, status: number) => c.json({ success: false, error: code, code }, status as any);
const iso = () => new Date().toISOString();
const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

type Row = { id: string; username: string; display_name: string | null; status: string; is_active: number; queue_paused: number; token_cipher: string | null; mgmt_revision: number; token_expires_at: string | null; data_access_expires_at: string | null };
type MgmtRequest = { operationId: string; action: Action; accountId: string | null; expectedRevision: string | null; expectedSubject: string; input: Record<string, unknown> };

function parseRequest(body: unknown): MgmtRequest {
  if (!plainObject(body)) throw new MgmtError('invalid_request', 400);
  const keys = Object.keys(body);
  if (keys.some(key => !BODY_KEYS.includes(key)) || BODY_KEYS.some(key => !(key in body))) throw new MgmtError('invalid_request', 400);
  const { operationId, action, accountId, expectedRevision, expectedSubject, input } = body;
  if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) throw new MgmtError('invalid_request', 400);
  if (typeof action !== 'string' || !action) throw new MgmtError('invalid_request', 400);
  if (!(ACTIONS as readonly string[]).includes(action)) throw new MgmtError(KNOWN_UNSUPPORTED.has(action) || /^[a-z_]{1,64}$/.test(action) ? 'unsupported_action' : 'invalid_request', 400);
  if (accountId !== null && (typeof accountId !== 'string' || !SUBJECT.test(accountId))) throw new MgmtError('invalid_request', 400);
  if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !REVISION.test(expectedRevision))) throw new MgmtError('invalid_request', 400);
  if (typeof expectedSubject !== 'string' || !SUBJECT.test(expectedSubject)) throw new MgmtError('invalid_request', 400);
  if (!plainObject(input)) throw new MgmtError('invalid_request', 400);
  const allowed = INPUT_KEYS[action as Action];
  const inputKeys = Object.keys(input);
  if (inputKeys.some(key => !allowed.required.includes(key) && !allowed.optional.includes(key)) || allowed.required.some(key => !(key in input))) throw new MgmtError('invalid_request', 400);
  if (action === 'create' ? accountId !== null || expectedRevision !== null : accountId === null || expectedRevision === null) throw new MgmtError('invalid_request', 400);
  if ('accessToken' in input && (typeof input.accessToken !== 'string' || !input.accessToken.trim() || input.accessToken.length > 4096)) throw new MgmtError('invalid_request', 400);
  if ('name' in input && input.name !== null && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)) throw new MgmtError('invalid_request', 400);
  if ('displayName' in input && input.displayName !== null && (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 100)) throw new MgmtError('invalid_request', 400);
  if ('name' in input && 'displayName' in input && input.name !== input.displayName) throw new MgmtError('invalid_request', 400);
  if (action === 'update_settings' && !inputKeys.length) throw new MgmtError('invalid_request', 400);
  return { operationId, action: action as Action, accountId: accountId as string | null, expectedRevision: expectedRevision as string | null, expectedSubject, input };
}

async function fingerprint(request: MgmtRequest) {
  // Key NAMES only: values (tokens, names) never reach the stored fingerprint.
  const material = [request.action, request.accountId ?? '', request.expectedRevision ?? '', request.expectedSubject, Object.keys(request.input).sort().join(',')].join('|');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

const expired = (row: Row) => [row.token_expires_at, row.data_access_expires_at].some(date => date && Date.parse(date) <= Date.now());
function present(row: Row) {
  const status = row.status === 'connected' && expired(row) ? 'expired' : row.status;
  const active = row.is_active === 1;
  const actions = ['update_settings', active ? 'deactivate' : 'activate', ...(row.token_cipher ? ['disconnect'] : []), 'reconnect'];
  return { id: row.id, subject: row.id, revision: String(row.mgmt_revision), name: row.display_name ?? row.username, username: row.username,
    isActive: active, isDefault: false, needsReauth: !row.token_cipher || status !== 'connected', status, actions };
}

type Receipt = { operation_id: string; request_fingerprint: string; action: string; account_id: string | null; result_revision: number | null };
const receiptLookup = (db: D1Database, operationId: string) => db.prepare('SELECT operation_id, request_fingerprint, action, account_id, result_revision FROM account_mgmt_receipts WHERE operation_id=?').bind(operationId).first<Receipt>();
const success = (receipt: Pick<Receipt, 'operation_id' | 'action' | 'account_id' | 'result_revision'>, replayed: boolean) => ({ success: true, data: { contract: CONTRACT, operationId: receipt.operation_id, action: receipt.action, accountId: receipt.account_id, revision: receipt.result_revision === null ? null : String(receipt.result_revision), replayed } });

async function classify(db: D1Database, request: MgmtRequest): Promise<MgmtError> {
  const row = await db.prepare('SELECT id, mgmt_revision FROM threads_accounts WHERE id=?').bind(request.accountId).first<{ id: string; mgmt_revision: number }>();
  if (!row) return new MgmtError('account_not_found', 404);
  if (row.id !== request.expectedSubject) return new MgmtError('subject_mismatch', 409);
  if (String(row.mgmt_revision) !== request.expectedRevision) return new MgmtError('revision_conflict', 409);
  // Account, subject and revision still match: the failure was storage/service, not stale state.
  return new MgmtError('internal_error', 500);
}

async function verified(verify: IdentityVerifier, token: string, env: Env, expectedSubject: string) {
  let identity: VerifiedIdentity;
  try { identity = await verify(token, env); }
  catch (error) {
    if (error instanceof ThreadsError) {
      // Status follows the mapped category: correctable credential input → 422, service failure → 502.
      const credential = error.kind === 'token_invalid' || error.kind === 'permission_denied' || error.code === 'missing_permissions' || error.code === 'token_user_mismatch';
      throw new MgmtError(credential ? 'credential_invalid' : 'identity_verification_failed', credential ? 422 : 502);
    }
    throw new MgmtError('identity_verification_failed', 502);
  }
  if (identity.id !== expectedSubject) throw new MgmtError('subject_mismatch', 409);
  return identity;
}

export function accountManagementRoutes(verify: IdentityVerifier) {
  const routes = new Hono<{ Bindings: Env }>();
  routes.onError((error, c) => {
    if (error instanceof MgmtError) return failure(c, error.code, error.status);
    if (error instanceof ThreadsError && error.code === 'encryption_key_invalid') return failure(c, 'service_not_configured', 503);
    console.error(JSON.stringify({ event: 'account_mgmt_error', code: 'internal_error' }));
    return failure(c, 'internal_error', 500);
  });

  routes.get('/accounts', async c => {
    const rows = (await c.env.DB.prepare('SELECT id, username, display_name, status, is_active, queue_paused, token_cipher, mgmt_revision, token_expires_at, data_access_expires_at FROM threads_accounts ORDER BY created_at DESC, id').all<Row>()).results;
    return c.json({ success: true, data: { contract: CONTRACT, accounts: rows.map(present) } });
  });

  routes.get('/operations/:operationId', async c => {
    const operationId = c.req.param('operationId');
    if (!OPERATION_ID.test(operationId)) return failure(c, 'invalid_request', 400);
    const receipt = await receiptLookup(c.env.DB, operationId);
    if (!receipt) return failure(c, 'receipt_not_found', 404);
    return c.json({ success: true, data: { operationId: receipt.operation_id, action: receipt.action, accountId: receipt.account_id, revision: receipt.result_revision === null ? null : String(receipt.result_revision) } });
  });

  routes.post('/operations', async c => {
    const request = parseRequest(await c.req.json().catch(() => undefined));
    const db = c.env.DB;
    const print = await fingerprint(request);
    const replay = async () => {
      const prior = await receiptLookup(db, request.operationId);
      if (!prior) return null;
      if (prior.request_fingerprint !== print) throw new MgmtError('operation_conflict', 409);
      return c.json(success(prior, true));
    };
    const replayed = await replay();
    if (replayed) return replayed;
    if (request.input.accessToken !== undefined) {
      try { validateEncryptionKey(c.env.TOKEN_ENCRYPTION_KEY ?? ''); } catch { throw new MgmtError('service_not_configured', 503); }
    }
    const created = iso();
    const fillReceipt = (accountId: string) => db.prepare('UPDATE account_mgmt_receipts SET result_revision=(SELECT mgmt_revision FROM threads_accounts WHERE id=?) WHERE operation_id=? AND result_revision IS NULL').bind(accountId, request.operationId);
    const commit = async (statements: D1PreparedStatement[], onEmpty: () => Promise<MgmtError>) => {
      let results: D1Result[];
      try { results = await db.batch(statements); }
      catch {
        // Atomic: nothing committed. A concurrent identical operation wins the receipt.
        const raced = await replay();
        if (raced) return raced;
        throw await onEmpty();
      }
      if (!results[0]?.meta.changes) {
        // An identical concurrent request may have committed first: replay it, not a conflict.
        const raced = await replay();
        if (raced) return raced;
        throw await onEmpty();
      }
      const receipt = await receiptLookup(db, request.operationId);
      if (!receipt) throw new MgmtError('internal_error', 500);
      return c.json(success(receipt, false));
    };

    if (request.action === 'create') {
      const subject = request.expectedSubject;
      // Cheap pre-check before any network call; the INSERT below is the real guard.
      if (await db.prepare('SELECT id FROM threads_accounts WHERE id=?').bind(subject).first()) {
        // An identical create may have just committed: replay it rather than reporting a duplicate.
        const raced = await replay();
        if (raced) return raced;
        throw new MgmtError('account_exists', 409);
      }
      const token = (request.input.accessToken as string).trim();
      const identity = await verified(verify, token, c.env, subject);
      const cipher = await seal(token, c.env.TOKEN_ENCRYPTION_KEY);
      const name = typeof request.input.name === 'string' ? request.input.name.trim() : null;
      return commit([
        db.prepare('INSERT INTO account_mgmt_receipts (operation_id, request_fingerprint, action, account_id, result_revision, created_at) VALUES (?,?,?,?,NULL,?)').bind(request.operationId, print, request.action, subject, created),
        // Plain INSERT (never upsert): a racing insert of the same subject aborts the whole batch.
        db.prepare('INSERT INTO threads_accounts (id, username, display_name, token_cipher, token_expires_at, data_access_expires_at, permissions_checked_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(subject, identity.username, name, cipher, identity.tokenExpiresAt, identity.dataAccessExpiresAt, created, created, created),
        fillReceipt(subject),
      ], async () => (await db.prepare('SELECT id FROM threads_accounts WHERE id=?').bind(subject).first()) ? new MgmtError('account_exists', 409) : new MgmtError('internal_error', 500));
    }

    const accountId = request.accountId as string;
    const expectedRevision = Number(request.expectedRevision);
    // Fail fast before any network call; the batch predicate still guards the write.
    const current = await db.prepare('SELECT id, mgmt_revision FROM threads_accounts WHERE id=?').bind(accountId).first<{ id: string; mgmt_revision: number }>();
    if (!current || current.id !== request.expectedSubject || current.mgmt_revision !== expectedRevision) {
      const raced = await replay();
      if (raced) return raced;
      throw await classify(db, request);
    }

    let change: D1PreparedStatement;
    const guard = 'WHERE id=? AND mgmt_revision=? AND id=?';
    const guardArgs = [accountId, expectedRevision, request.expectedSubject];
    switch (request.action) {
      case 'reconnect': {
        const token = (request.input.accessToken as string).trim();
        const identity = await verified(verify, token, c.env, request.expectedSubject);
        const cipher = await seal(token, c.env.TOKEN_ENCRYPTION_KEY);
        // Same as a legacy reconnect: queue_paused is untouched, resume stays explicit.
        change = db.prepare(`UPDATE threads_accounts SET username=?, token_cipher=?, status='connected', token_expires_at=?, data_access_expires_at=?, permissions_checked_at=?, last_error_code=NULL, last_error_kind=NULL, updated_at=? ${guard}`)
          .bind(identity.username, cipher, identity.tokenExpiresAt, identity.dataAccessExpiresAt, created, created, ...guardArgs);
        break;
      }
      case 'update_settings':
        change = db.prepare(`UPDATE threads_accounts SET display_name=?, updated_at=? ${guard}`)
          .bind((({ name = request.input.displayName }) => typeof name === 'string' ? name.trim() : null)(request.input), created, ...guardArgs);
        break;
      case 'deactivate':
        // Logical stop: the existing publisher gate (queue_paused) stops publication.
        change = db.prepare(`UPDATE threads_accounts SET is_active=0, queue_paused=1, updated_at=? ${guard}`).bind(created, ...guardArgs);
        break;
      case 'activate':
        // Never restarts the publication queue; the legacy /resume stays an explicit, separate step.
        change = db.prepare(`UPDATE threads_accounts SET is_active=1, updated_at=? ${guard}`).bind(created, ...guardArgs);
        break;
      case 'disconnect':
        change = db.prepare(`UPDATE threads_accounts SET status='disconnected', queue_paused=1, token_cipher=NULL, updated_at=? ${guard}`).bind(created, ...guardArgs);
        break;
      default:
        throw new MgmtError('unsupported_action', 400);
    }
    return commit([
      db.prepare(`INSERT INTO account_mgmt_receipts (operation_id, request_fingerprint, action, account_id, result_revision, created_at) SELECT ?,?,?,?,NULL,? WHERE EXISTS (SELECT 1 FROM threads_accounts ${guard})`)
        .bind(request.operationId, print, request.action, accountId, created, ...guardArgs),
      change,
      fillReceipt(accountId),
    ], () => classify(db, request));
  });
  return routes;
}
