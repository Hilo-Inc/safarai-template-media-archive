# Media Archive

A self-hosted home for your photos, videos and music. Your posts are kept in your own S3-compatible bucket and shown on your own site, in a layout close to the platform they came from.

- **Import from your browser.** Drop export zips or folders on the admin page. Only photos, videos, audio and their caption files are uploaded; everything else stays on your computer.
- **Your bucket is the database.** Every post is a JSON file next to its media (`posts/<id>.json`, `media/<id>/…`), so the archive outlives this app.
- **Public or private.** Public sites get RSS and JSON feeds. Password mode needs a password for every page and serves media through short-lived signed links.
- **Clean files.** Location and camera metadata are removed from every photo, video and audio file before it is stored.

## Launch on Safarai

Pick **Media Archive** in the Safarai template gallery. Safarai creates the bucket and writes the storage settings and passwords for you. The admin password is shown in the app's settings.

## Self-hosting

You need Docker and an S3-compatible bucket (Cloudflare R2, Hetzner Object Storage, MinIO, AWS S3).

1. Copy `.env.example` to `.env` and fill it in (see the table below).
2. Allow your site's address in the bucket's CORS rules, because the browser uploads directly to the bucket:
   - methods `GET`, `HEAD`, `PUT`, `POST`, `DELETE`;
   - header `content-type`;
   - exposed header `ETag`.
3. Build and run:

   ```bash
   docker build -t media-archive .
   docker run --env-file .env -p 3000:3000 media-archive
   ```

4. Open `http://localhost:3000/admin` and sign in with `ADMIN_PASSWORD`.

| Variable | Required | Meaning |
|---|---|---|
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | The bucket. The key needs read and write access to it. |
| `S3_REGION` | no | Default `auto`. |
| `S3_FORCE_PATH_STYLE` | no | `1` for MinIO and similar servers. |
| `ADMIN_PASSWORD` | yes | Admin sign-in. At least 12 characters. |
| `SITE_VISIBILITY` | no | `public` (default) or `password`. Overrides `archive.config.json`. |
| `VIEWER_PASSWORD` | in password mode | Viewer sign-in. At least 12 characters and different from `ADMIN_PASSWORD`. |
| `MEDIA_PUBLIC_URL` | no | Public mode: the address the bucket is served at. Without it, media links are signed. |
| `SITE_URL` | no | The site's own address, used for the absolute links in the feeds. |
| `SESSION_SECRET` | no | A fixed cookie secret. |
| `WORK_DIR` | no | Where files are processed during an import. Default: a folder in the system temp directory. |

### Feed addresses

Feeds (`/feed.json`, `/rss.xml`) contain absolute links. Those links come only from `SITE_URL`, or from `COOLIFY_URL` when you deploy on Coolify or Safarai. They are never taken from the request's `Host` header, so a forged header cannot change them. Set `SITE_URL` to your public address (for example `https://archive.example.com`) when you self-host.

## Configuration

`archive.config.json` holds the defaults. The environment variables in brackets override them:

| Key | Values | Default |
|---|---|---|
| `preset` (`ARCHIVE_PRESET`) | `instagram`, `tiktok`, `youtube`, `soundcloud`, `facebook`, `generic` | `generic` |
| `visibility` (`SITE_VISIBILITY`) | `public`, `password` | `public` |
| `kinds` (`ARCHIVE_KINDS`, comma-separated) | `post`, `reel`, `story`, `igtv`, `video`, `short`, `track` | the preset's kinds |
| `location` (`ARCHIVE_LOCATION`) | `none`, `place`, `rounded`, `exact` | `none` |
| `mentions` (`ARCHIVE_MENTIONS`) | `text`, `link` | `text` |
| `exclude` | fixed: `archived`, `deleted`, `draft` | |

An invalid value stops the container at start, with a message that names the key and the allowed values.

## What can be imported

- **Photos, videos and audio**, as files, folders or zips. Each file becomes one post. Accepted types:
  - images: JPG, JPEG, PNG, WebP, GIF, AVIF, TIF, TIFF;
  - video: MP4, M4V, MOV, WebM, MKV, AVI;
  - audio: MP3, M4A, AAC, WAV, FLAC, OGG, OPUS.
- **yt-dlp downloads** saved with `--write-info-json` (and `--write-subs`): title, description, tags, date and subtitles are kept.
- **gallery-dl downloads** saved with `--write-metadata`: multi-image posts stay together, with their caption and date.
- **Instagram and Facebook exports**: coming in a later update. They are refused for now, and nothing in them is uploaded.

Messages, contacts, followers, login records, ads data and anything that is not media are never uploaded.

## Bucket layout

| Path | Content |
|---|---|
| `posts/<id>.json` | One post (schema at `/schema/post.v1.json`). |
| `media/<id>/<n>/` | `orig.<ext>`, `w320/640/1280/2048.webp` (plus one at the image's own width below 2048), `poster.webp`, `peaks.json`, `subs.<lang>.vtt`. |
| `index/` | Paged listings used by the site. |
| `feed.json`, `rss.xml` | Feeds (public mode). |
| `inbox/` | Put files here yourself (e.g. with rclone), then press **Re-index** in the admin. |
| `_system/` | Settings and import state. Never public. |

## Development

```bash
npm install
npm run dev                      # http://localhost:3000; needs the S3 variables
npm test                         # unit tests
npm run test:int                 # integration tests against s3mock (Docker)
npm run sample-export -- sample-export   # a generated export for trying the importer
```

Needs `ffmpeg`, `ffprobe` and `exiftool` on your PATH for processing and for the tests. The sample export needs `ffmpeg`; without `exiftool` its photos simply carry no GPS tag.

## Try the demo

See the template with placeholder posts on your own computer. You need Docker.

    npm run demo        # builds and starts it, fills it on first run, prints the address
    npm run demo:down   # stops it and deletes the demo content

Open http://localhost:3000. To try the admin, sign in at http://localhost:3000/login with the demo
password that `npm run demo` prints (it is in `demo.env` and works only on your computer). Uploading
files from the admin's Import page does not work in the demo; everything else does.

## License

MIT
