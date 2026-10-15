import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { anthropicThinkingOff, anthropicAlwaysThinks } from '../src/utils/anthropic-thinking.js';
import { getAnthropicEffortLevels } from '../src/constants.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('anthropicThinkingOff（思考の深さ: OFF のときに送る形）', () => {
    // 回帰: 以前は全モデルに disabled を送っていて、これらのモデルでは毎回 400 になっていた
    it('Opus 5.5 / Fable 5 系 / Mythos 5 系は思考を止められないので、thinking を送らず low にする', () => {
        for (const m of ['claude-opus-5-5', 'claude-opus-5.5', 'claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5-1']) {
            expect(anthropicThinkingOff(m)).toEqual({ thinking: null, effort: 'low' });
            expect(anthropicAlwaysThinks(m)).toBe(true);
        }
    });

    it('Sonnet 5.5 は disabled ではなく between_tools で止める', () => {
        expect(anthropicThinkingOff('claude-sonnet-5-5')).toEqual({ thinking: { type: 'between_tools' }, effort: null });
    });

    // 'claude-opus-5' / 'claude-sonnet-5' の前方一致で 5.5 と取り違えない
    it('Opus 5 / Sonnet 5 / Haiku 5.5 / 4.x は従来どおり disabled', () => {
        for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']) {
            expect(anthropicThinkingOff(m)).toEqual({ thinking: { type: 'disabled' }, effort: null });
            expect(anthropicAlwaysThinks(m)).toBe(false);
        }
    });

    it('Claude 3.x には thinking を送らない', () => {
        expect(anthropicThinkingOff('claude-3-5-haiku-20241022')).toEqual({ thinking: null, effort: null });
    });
});

describe('Effort の選択肢', () => {
    it('Sonnet 5.5 / Haiku 5.5 は low〜max を選べる（Haiku 4.5 は OFF のみのまま）', () => {
        expect(getAnthropicEffortLevels('claude-sonnet-5-5')).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
        expect(getAnthropicEffortLevels('claude-haiku-5-5')).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
        expect(getAnthropicEffortLevels('claude-haiku-4-5-20251001')).toEqual(['']);
    });
});

describe('Claude への送信内容の配線', () => {
    it('OFF のときは anthropicThinkingOff の形で送り、disabled を直書きしていない', () => {
        const api = read('src/api.js');
        expect(api).toContain('const thinkingOff = useAdaptive ? null : anthropicThinkingOff(model);');
        expect(api).not.toContain("requestBody.thinking = { type: 'disabled' };");
        expect(api).toContain('requestBody.output_config = { effort: effort || thinkingOff.effort };');
    });

    it('Haiku 5.5 にも temperature を送らない', () => {
        expect(read('src/api.js')).toMatch(/rejectsSamplingParams = \[[^\]]*'claude-haiku-5'/);
    });
});
