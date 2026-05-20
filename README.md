# 233 Life Notion Blog

A React SPA and Cloudflare Worker blog system backed by a Notion database. The
frontend talks to the Worker through JSON APIs; content, settings, sync records,
and rendered Markdown are stored in D1, while downloaded Notion assets are stored
in R2 and served through a configured CDN base URL.

## Local Development

Install dependencies:

```bash
npm install
```

Create a local Worker secret in `.dev.vars`:

```bash
node -e "console.log('CONFIG_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64url'))" > .dev.vars
```

Turnstile is disabled locally unless both `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` are configured.

Apply the local D1 migrations:

```bash
npx wrangler d1 migrations apply 233-life-notion-blog --local
```

Start the development server:

```bash
npm run dev
```

The app is available at `http://localhost:5173`.

## Admin Console

Open `/admin` and log in with the initial password:

```text
123456
```

The first login requires changing this password before protected settings and
sync actions are available.

Configure the Notion source in the admin settings page. The default database URL
is prefilled as:

```text
https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link
```

You still need to provide a Notion integration token and a CDN base URL for R2
asset delivery.

The supported Notion metadata mapping is intentionally small: title, publish
status, and an optional published date. Slugs are generated from the title. If a
Notion page has a page cover, sync uploads it to R2 and stores the CDN URL in
`posts.cover_url`.

## Notion Blog Setup

1. Create Cloudflare resources:

```bash
npx wrangler d1 create 233-life-notion-blog
npx wrangler r2 bucket create 233-life-notion-blog-assets
```

2. Replace the placeholder D1 `database_id` in `wrangler.json` with the ID
   returned by `wrangler d1 create`.

3. Set the encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put CONFIG_ENCRYPTION_KEY
```

Set the Turnstile secret key for access checks and comment submission:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

4. Apply remote migrations:

```bash
npx wrangler d1 migrations apply 233-life-notion-blog
```

5. Deploy:

```bash
npm run deploy
```

6. Open `/admin`, log in with `123456`, change the password, and configure
   Notion.

## Verification

Run the project checks before deploying:

```bash
npm test
npm run typecheck
npm run check
```

Useful smoke-test URLs:

- `/` renders the public blog shell.
- `/admin` renders the password-protected admin console.
- `/api/health` returns `{ "ok": true }`.
