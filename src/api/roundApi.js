/**
 * DunkShot — 後端 API 呼叫層
 *
 * 開發時（emulator）：BASE_URL 指向本地 5001 port
 * 正式部署後：改為 Firebase Functions 的 HTTPS URL
 *
 * 使用方式：
 *   import * as api from '../api/roundApi.js';
 *   const round = await api.createRound('normal', 100);
 *   const ball  = await api.nextBall(round.roundId);
 */

// ─── 環境切換 ─────────────────────────────────────────────
// 本地 Emulator：http://127.0.0.1:5001/<projectId>/asia-east1/<fnName>
// 正式環境：https://asia-east1-<projectId>.cloudfunctions.net/<fnName>

const PROJECT_ID = 'dunkshotcrash';            // Firebase Project ID
const REGION     = 'asia-east1';

const IS_DEV = import.meta.env?.DEV ?? false;

const BASE = IS_DEV
  ? `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}`
  : `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

// ─── 通用 fetch 工具 ──────────────────────────────────────

async function post(endpoint, body = {}) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `API error: ${endpoint}`);
  return data;
}

async function get(endpoint, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${BASE}/${endpoint}${qs ? '?' + qs : ''}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `API error: ${endpoint}`);
  return data;
}

// ─── API 方法 ─────────────────────────────────────────────

/**
 * 建立新局
 * @param {string} difficulty  'easy' | 'normal' | 'hard'
 * @param {number} betAmount   投注金額
 * @param {string} [clientSeed] 可選，前端自訂種子（Provably Fair）
 * @returns {{ roundId, serverSeedHash, clientSeed, difficulty, betAmount }}
 */
export async function createRound(difficulty, betAmount, clientSeed) {
  return post('createRound', { difficulty, betAmount, clientSeed });
}

/**
 * 取下一球物理參數
 * @param {string} roundId
 * @returns {{ nonce, params, difficulty }}
 */
export async function nextBall(roundId) {
  return post('nextBall', { roundId });
}

/**
 * 記錄進球
 * @param {string} roundId
 * @returns {{ ballsScored, multiplier, potentialPayout }}
 */
export async function recordScore(roundId) {
  return post('recordScore', { roundId });
}

/**
 * 兌現
 * @param {string} roundId
 * @returns {{ roundId, payout, multiplier, ballsScored, serverSeed, serverSeedHash, clientSeed, physicsLog }}
 */
export async function cashout(roundId) {
  return post('cashout', { roundId });
}

/**
 * 失敗（球未進）
 * @param {string} roundId
 * @returns {{ roundId, payout, ballsScored, serverSeed, serverSeedHash, clientSeed, physicsLog }}
 */
export async function fail(roundId) {
  return post('fail', { roundId });
}

/**
 * 查詢局詳情 + Provably Fair 驗證（局結束後）
 * @param {string} roundId
 * @returns {{ roundId, seedValid, serverSeed, serverSeedHash, clientSeed, physicsLog }}
 */
export async function verifyRound(roundId) {
  return get('round', { id: roundId });
}
