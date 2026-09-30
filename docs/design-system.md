# Design System

Shared design tokens for the mobile app (React Native) and web app (React + MUI).
Both apps pull from these same values so the product feels consistent across platforms.
Don't hardcode colours, fonts, or spacing in components, reference the theme instead.

## Palette — "Riverstone"

| Token             | Hex       | Use                                       |
|-------------------|-----------|-------------------------------------------|
| `primary`         | `#3F5F68` | Main actions, active nav, links           |
| `primaryDark`     | `#2E464D` | Hover/pressed states                      |
| `secondary`       | `#6F8F52` | Secondary actions, success accents        |
| `alert`           | `#D9A24B` | Warnings, IoT sensor alerts               |
| `error`           | `#C0392B` | Errors, rejected status                   |
| `success`         | `#4C7A3D` | Approved status (distinct from primary)   |
| `surface`         | `#F1F0EC` | Page/card background                      |
| `surfaceWhite`    | `#FFFFFF` | Card background on top of surface         |
| `textPrimary`     | `#22282A` | Main text                                 |
| `textSecondary`   | `#5C6669` | Muted/secondary text                      |
| `border`          | `#D8D6CF` | Dividers, input borders                   |

## Typography

Font: **Inter**

| Token         | Size | Weight | Use                          |
|---------------|------|--------|------------------------------|
| `heading1`    | 28px | 600    | Page titles                  |
| `heading2`    | 22px | 600    | Section headers              |
| `heading3`    | 18px | 500    | Card/subsection titles       |
| `body`        | 16px | 400    | Default text                 |
| `bodySmall`   | 14px | 400    | Secondary text, table cells  |
| `caption`     | 12px | 400    | Timestamps, hints, metadata  |

Only weights 400, 500, and 600 are used, avoid 300 (light) and 700 (bold).

## Spacing

Fixed scale, in px: `4, 8, 12, 16, 24, 32, 48`

## Other

- **Border radius**: `8px` default (cards, inputs, buttons), `16px`+ only for deliberately pill-shaped elements
- **Button height**: `44px` minimum (accessibility touch target)

## Where this lives in code

- Web: `web-app/src/theme/theme.js`
- Mobile: `mobile-app/src/theme/theme.js`
- Mobile shared components (Button, etc.): `mobile-app/src/components/`