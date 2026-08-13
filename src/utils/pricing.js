// 料金テーブルと単価の選択。DB・DOMには触らない純粋関数だけを置く。
// 単位はいずれも USD / 100万トークン。in=入力(キャッシュミス), out=出力,
// cw5m/cw1h=キャッシュ書込, cr=キャッシュ読込(ヒット)。

export const MODEL_PRICING = {
    // Claude 5系 / 4系 (claude-opus-5, claude-opus-4-x, claude-sonnet-4-x, claude-haiku-4-x)
    'claude-opus-5':   { in: 5,    out: 25,  cw5m: 6.25,  cw1h: 10,   cr: 0.50 },
    'claude-opus-4-8': { in: 5,    out: 25,  cw5m: 6.25,  cw1h: 10,   cr: 0.50 },
    'claude-opus-4-7': { in: 5,    out: 25,  cw5m: 6.25,  cw1h: 10,   cr: 0.50 },
    'claude-opus-4-6': { in: 5,    out: 25,  cw5m: 6.25,  cw1h: 10,   cr: 0.50 },
    'claude-opus-4-5': { in: 5,    out: 25,  cw5m: 6.25,  cw1h: 10,   cr: 0.50 },
    'claude-opus-4-1': { in: 15,   out: 75,  cw5m: 18.75, cw1h: 30,   cr: 1.50 },
    'claude-opus-4':   { in: 15,   out: 75,  cw5m: 18.75, cw1h: 30,   cr: 1.50 },
    'claude-sonnet-4': { in: 3,    out: 15,  cw5m: 3.75,  cw1h: 6,    cr: 0.30 },
    'claude-haiku-4':  { in: 1,    out: 5,   cw5m: 1.25,  cw1h: 2,    cr: 0.10 },
    // Claude 3系 (旧モデル)
    'claude-opus-3':   { in: 15,   out: 75,  cw5m: 18.75, cw1h: 30,   cr: 1.50 },
    'claude-opus':     { in: 5,    out: 25,  cw5m: 6.25,  cw1h: 10,   cr: 0.50 },
    'claude-sonnet':   { in: 3,    out: 15,  cw5m: 3.75,  cw1h: 6,    cr: 0.30 },
    'claude-haiku':    { in: 0.80, out: 4,   cw5m: 1.00,  cw1h: 1.60, cr: 0.08 },
    // DeepSeek（in=キャッシュミス入力, cr=キャッシュヒット入力）。価格は「通常（オフピーク）」基準。
    // peakMul があるモデルは、ピーク時間帯のメッセージのみ料金を peakMul 倍にする。
    // V4系は 2026-08-16 の改定後の価格。
    'deepseek-reasoner': { in: 0.55,  out: 2.19, cw5m: 0.55,  cw1h: 0.55,  cr: 0.14 },
    'deepseek-chat':     { in: 0.27,  out: 1.10, cw5m: 0.27,  cw1h: 0.27,  cr: 0.07 },
    'deepseek-v4-pro':   { in: 0.66,  out: 1.98, cw5m: 0.66,  cw1h: 0.66,  cr: 0.022,    peakMul: 2 },
    'deepseek-v4-flash': { in: 0.22,  out: 0.66, cw5m: 0.22,  cw1h: 0.22,  cr: 0.007,    peakMul: 2 },
    'deepseek-':         { in: 0.27,  out: 1.10, cw5m: 0.27,  cw1h: 0.27,  cr: 0.07 },
    // xAI Grok。プロンプトが longCtxThreshold 以上のリクエストは単価が longCtxMul 倍になる。
    // https://docs.x.ai/developers/pricing
    'grok-4-6': { in: 2, out: 6, cw5m: 2, cw1h: 2, cr: 0.50, longCtxThreshold: 200_000, longCtxMul: 2 },
};

// DeepSeek V4 の値上げ時刻（2026-08-16 16:00 UTC = 日本時間 8/17 01:00）。
export const DEEPSEEK_V4_PRICE_CHANGE_AT = Date.UTC(2026, 7, 16, 16, 0, 0);

// 改定前の V4 料金。過去のメッセージを当時の単価で計算するために残してある。
export const MODEL_PRICING_BEFORE_V4_CHANGE = {
    'deepseek-v4-pro':   { in: 0.435, out: 0.87, cw5m: 0.435, cw1h: 0.435, cr: 0.003625, peakMul: 2 },
    'deepseek-v4-flash': { in: 0.14,  out: 0.28, cw5m: 0.14,  cw1h: 0.14,  cr: 0.0028,   peakMul: 2 },
};

/**
 * OpenRouter形式のモデル名を料金表のキーに合わせて整える。
 * 例: 'anthropic/claude-opus-4.5:beta' → 'claude-opus-4-5'
 * OpenRouterは提供元の価格をほぼそのまま通すため、上流の単価で概算できる
 * （クレジット購入時の手数料ぶんだけ実際の請求は少し高くなる）。
 * @param {string} modelName
 * @returns {string} 正規化した名前（小文字）
 */
export function normalizeModelName(modelName) {
    if (typeof modelName !== 'string') return '';
    return modelName
        .toLowerCase()
        .trim()
        .replace(/^[^/]+\//, '')  // 'anthropic/' などのベンダー接頭辞を外す
        .replace(/:.*$/, '')      // ':free' ':beta' などのバリアント指定を外す
        .replace(/(\d)\.(\d)/g, '$1-$2'); // 'claude-opus-4.5' → 'claude-opus-4-5'
}

/**
 * モデル名から単価を引く。前方一致なので長いキーから順に並べてある。
 * 直接APIの名前で引けなければ、OpenRouter形式として正規化して引き直す。
 * @param {string} modelName
 * @param {number} [timestamp] メッセージの生成時刻(epoch ms)。値上げ前後の切り替えに使う
 * @returns {object|null} 単価。該当が無ければ null
 */
export function getPricing(modelName, timestamp) {
    if (!modelName) return null;
    const isOld = !timestamp || timestamp < DEEPSEEK_V4_PRICE_CHANGE_AT; // 時刻無しは改定前の古いデータ
    const lookup = (m) => {
        if (isOld) {
            for (const [key, price] of Object.entries(MODEL_PRICING_BEFORE_V4_CHANGE)) {
                if (m.startsWith(key)) return price;
            }
        }
        for (const [key, price] of Object.entries(MODEL_PRICING)) {
            if (m.startsWith(key)) return price;
        }
        return null;
    };
    return lookup(modelName.toLowerCase()) || lookup(normalizeModelName(modelName));
}

/**
 * DeepSeek のピーク時間帯かどうか（UTC 01:00-04:00 / 06:00-10:00 = 日本時間 10-13時 / 15-19時）。
 * タイムゾーンに依存しないよう UTC 時刻で判定する。
 * @param {number} timestamp モデル応答生成時刻(epoch ms)
 */
export function isDeepSeekPeak(timestamp) {
    if (!timestamp) return false;
    const h = new Date(timestamp).getUTCHours();
    return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}
