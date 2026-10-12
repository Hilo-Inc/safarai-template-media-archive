import { describe, expect, it } from 'vitest';
import { IG, instagramFiles, instagramJson, INSTAGRAM_MEDIA } from '../fixtures/instagram';

describe('instagram fixture', () => {
  it('has every JSON file the importer reads, plus IGTV, in valid JSON', () => {
    const json = instagramJson();
    for (const name of ['posts_1', 'posts_2', 'posts', 'reels', 'stories', 'profile_photos', 'archived_posts', 'recently_deleted_content', 'igtv_videos']) {
      expect(() => JSON.parse(json[`${IG}${name}.json`]!), name).not.toThrow();
    }
  });

  it('places files under a root and can leave some out', () => {
    const files = instagramFiles({ root: 'part1/', omit: ['media/posts/202401/c2.jpg'] });
    expect(Object.keys(files).every((p) => p.startsWith('part1/'))).toBe(true);
    expect(files['part1/media/posts/202401/c2.jpg']).toBeUndefined();
    expect(files['part1/media/posts/202401/c1.jpg']).toEqual({ size: 100 });
  });

  it('includes denied files so tests can prove they are never touched', () => {
    expect(Object.keys(INSTAGRAM_MEDIA)).toContain('your_instagram_activity/messages/inbox/someone_1/photo.jpg');
    expect(Object.keys(instagramFiles())).toContain('personal_information/personal_information/personal_information.json');
  });
});
