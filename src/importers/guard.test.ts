import { describe, expect, it } from 'vitest';
import { isDeniedPath, isJunkPath, isMetaExport } from './guard';

describe('isDeniedPath', () => {
  it('denies private folders at any depth, any case', () => {
    expect(isDeniedPath('your_instagram_activity/messages/inbox/a/message_1.json')).toBe(true);
    expect(isDeniedPath('export/Personal_Information/info.json')).toBe(true);
    expect(isDeniedPath('connections/followers_1.json')).toBe(true);
    expect(isDeniedPath('ads_information/x.json')).toBe(true);
    expect(isDeniedPath('security_and_login_information/login.json')).toBe(true);
    expect(isDeniedPath('comments/post_comments.json')).toBe(true);
    expect(isDeniedPath('contacts.vcf')).toBe(false);
    expect(isDeniedPath('contacts/synced.json')).toBe(true);
    expect(isDeniedPath('videos/holiday.mp4')).toBe(false);
  });
});

describe('isJunkPath', () => {
  it('skips OS clutter', () => {
    expect(isJunkPath('__MACOSX/videos/._a.mp4')).toBe(true);
    expect(isJunkPath('videos/._a.mp4')).toBe(true);
    expect(isJunkPath('videos/.DS_Store')).toBe(true);
    expect(isJunkPath('videos/Thumbs.db')).toBe(true);
    expect(isJunkPath('videos/a.mp4')).toBe(false);
  });
});

describe('isMetaExport', () => {
  it('recognises Instagram and Facebook exports', () => {
    expect(isMetaExport(['your_instagram_activity/media/posts_1.json', 'media/posts/202501/a.jpg'])).toBe(true);
    expect(isMetaExport(['instagram-me-2025/your_facebook_activity/posts/x.json'])).toBe(true);
    expect(isMetaExport(['content/posts_1.json', 'media/posts/a.jpg'])).toBe(true);
    expect(isMetaExport(['messages/inbox/friend_1/message_1.json'])).toBe(true);
    expect(isMetaExport(['videos/a.mp4', 'videos/a.info.json'])).toBe(false);
  });
});
