import { describe, expect, it } from 'vitest';
import { isDeniedName, isDeniedPath, isJunkPath, isMetaExport } from './guard';

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

describe('guard hardening', () => {
  it('handles backslashes, case, whitespace, full-width and dot segments', () => {
    for (const p of [
      'messages\\photos\\a.jpg',
      'Messages /a.jpg',
      'ｍｅｓｓａｇｅｓ/a.jpg',
      './messages/a.jpg',
      'ok/../messages/a.jpg',
      'MESSAGES/inbox/x',
      'x/profile/a.jpg',
      'followers_and_following/a.json',
      'login_and_account_creation/a.json',
      'account_information/a.json',
    ]) expect(isDeniedPath(p), p).toBe(true);
    expect(isDeniedPath('ok/a.jpg')).toBe(false);
  });

  it('denies files named like a denied folder', () => {
    expect(isDeniedName('x/messages')).toBe(true);
    expect(isDeniedName('x/Comments.json')).toBe(true);
    expect(isDeniedName('raw/IMG_0001')).toBe(false);
  });

  it('matches __MACOSX case-insensitively and with backslashes', () => {
    expect(isJunkPath('__macosx/a.mp4')).toBe(true);
    expect(isJunkPath('a\\__MACOSX\\a.mp4')).toBe(true);
  });

  it('recognises backslash and older flat Meta layouts', () => {
    expect(isMetaExport(['your_instagram_activity\\media\\x.jpg'])).toBe(true);
    expect(isMetaExport(['profile.json'])).toBe(true);
    expect(isMetaExport(['export/profile.json'])).toBe(true);
    expect(isMetaExport(['a/b/profile.json'])).toBe(false);
    expect(isMetaExport(['connections/followers.json'])).toBe(true);
  });
});

describe('guard hardening round 2', () => {
  it('only treats data files as denied names', () => {
    expect(isDeniedName('profile.jpg')).toBe(false);
    expect(isDeniedName('x/Profile.png')).toBe(false);
    expect(isDeniedName('x/contacts.mp4')).toBe(false);
    expect(isDeniedName('x/messages.mp4')).toBe(false);
    expect(isDeniedName('x/messages')).toBe(true);
    expect(isDeniedName('x/messages.json')).toBe(true);
    expect(isDeniedName('x/comments.html')).toBe(true);
    expect(isDeniedName('x/comments.htm')).toBe(true);
    expect(isDeniedName('x/comments.txt')).toBe(true);
  });

  it('removes format characters before comparing segments', () => {
    expect(isDeniedPath('messages​/a.jpg')).toBe(true);
    expect(isDeniedPath('me­ssages/a.jpg')).toBe(true);
  });
});
