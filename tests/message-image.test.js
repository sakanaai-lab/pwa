import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessageImageFilename, shareOrDownloadImage } from '../src/utils/message-image.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('createMessageImageFilename', () => {
    it('uses the turn, role, and local timestamp', () => {
        const element = document.createElement('div');
        element.className = 'message user';
        element.dataset.turn = '7';

        expect(createMessageImageFilename(element, new Date(2026, 5, 14, 9, 8, 7))).toBe(
            'Aquarium_Chat_7_user_20260614-090807.png'
        );
    });

    it('falls back when the message has no turn number', () => {
        const element = document.createElement('div');
        element.className = 'message model';

        expect(createMessageImageFilename(element, new Date(2026, 0, 2, 3, 4, 5))).toBe(
            'Aquarium_Chat_message_assistant_20260102-030405.png'
        );
    });
});

describe('shareOrDownloadImage', () => {
    it('uses the native share sheet when file sharing is supported', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', {
            canShare: vi.fn().mockReturnValue(true),
            share,
        });

        const result = await shareOrDownloadImage(
            new Blob(['png'], { type: 'image/png' }),
            'chat.png'
        );

        expect(result).toBe('shared');
        expect(share).toHaveBeenCalledOnce();
    });

    it('does not download when the user cancels the share sheet', async () => {
        const abortError = new Error('cancelled');
        abortError.name = 'AbortError';
        vi.stubGlobal('navigator', {
            canShare: vi.fn().mockReturnValue(true),
            share: vi.fn().mockRejectedValue(abortError),
        });
        const result = await shareOrDownloadImage(
            new Blob(['png'], { type: 'image/png' }),
            'chat.png'
        );

        expect(result).toBe('cancelled');
    });

    it('falls back to download when Safari rejects canShare', async () => {
        const securityError = new Error('The operation is insecure.');
        securityError.name = 'SecurityError';
        vi.stubGlobal('navigator', {
            canShare: vi.fn(() => {
                throw securityError;
            }),
            share: vi.fn(),
        });
        URL.createObjectURL = vi.fn(() => 'blob:test-image');
        URL.revokeObjectURL = vi.fn();
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        const result = await shareOrDownloadImage(
            new Blob(['png'], { type: 'image/png' }),
            'chat.png'
        );

        expect(result).toBe('downloaded');
        expect(click).toHaveBeenCalledOnce();
    });
});
