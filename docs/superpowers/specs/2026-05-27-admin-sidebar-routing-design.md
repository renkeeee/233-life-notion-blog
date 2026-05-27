# Admin Sidebar Routing Design

## Goal

Restructure the admin console from top tabs into a two-column dashboard layout with a persistent left sidebar and URL-backed sections.

## Routes

- `/admin` redirects to `/admin/overview`.
- `/admin/overview` shows the dashboard overview.
- `/admin/posts` shows post management.
- `/admin/sync` shows sync controls/history.
- `/admin/album` shows album management.
- `/admin/settings` shows password and data source settings.
- Unknown `/admin/*` paths redirect to `/admin/overview`.

## Layout

The authenticated admin view uses a fixed-width shell with a sidebar and a content panel. The sidebar contains the site identity, grouped section links, and logout. The content area keeps the existing section components intact.

On narrow screens, the layout collapses to a single column and the sidebar links wrap horizontally so the admin remains usable on mobile.

## Behavior

Navigation uses React Router links instead of component state, so refreshes and direct links preserve the current section. Login lands on the current requested section when possible. Logout returns the session to guest state.

Existing authorization behavior stays unchanged: settings can still show password management, and protected actions remain disabled or blocked when the initial password must be changed.

## Testing

Tests should verify that `/admin` redirects to `/admin/overview`, sidebar links navigate to section paths, the correct section content loads from a direct URL, and the sidebar layout classes are present.
